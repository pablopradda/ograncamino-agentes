import Anthropic from '@anthropic-ai/sdk';
import { google } from 'googleapis';
import XLSX from 'xlsx';

// Cliente Claude
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Cliente Google Drive
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}'),
  scopes: ['https://www.googleapis.com/auth/drive.readonly']
});

const drive = google.drive({ version: 'v3', auth });

// ID de la carpeta principal de Drive
const MAIN_FOLDER_ID = process.env.DRIVE_FOLDER_ID || '1LMhvJktYAvY9MISgaQipiiCnttM838Sj';

// Cache simple en memoria
const cache = new Map();

// Listar archivos de Drive
async function listDriveFiles(folderId = MAIN_FOLDER_ID) {
  const cacheKey = `files_${folderId}`;
  
  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey);
    if (Date.now() - cached.timestamp < 5 * 60 * 1000) {
      return cached.data;
    }
  }
  
  try {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id, name, mimeType, webViewLink, size, modifiedTime)',
      orderBy: 'name',
      pageSize: 100
    });
    
    const files = response.data.files || [];
    cache.set(cacheKey, { data: files, timestamp: Date.now() });
    
    return files;
  } catch (error) {
    console.error('Error listing files:', error);
    return [];
  }
}

// Leer archivo de Drive
async function readFileContent(fileId, mimeType) {
  try {
    if (mimeType === 'application/vnd.google-apps.document') {
      const response = await drive.files.export({
        fileId: fileId,
        mimeType: 'text/plain'
      });
      return response.data;
    }
    
    const response = await drive.files.get(
      { fileId: fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    
    return Buffer.from(response.data);
  } catch (error) {
    console.error('Error reading file:', error);
    return null;
  }
}

// Procesar Excel
async function processExcel(fileId) {
  try {
    const buffer = await readFileContent(fileId);
    if (!buffer) return { error: 'No se pudo leer el archivo' };
    
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const result = {};
    
    workbook.SheetNames.forEach(sheetName => {
      const sheet = workbook.Sheets[sheetName];
      result[sheetName] = XLSX.utils.sheet_to_json(sheet);
    });
    
    return result;
  } catch (error) {
    console.error('Error processing Excel:', error);
    return { error: error.message };
  }
}

// Procesar GPX
async function processGPX(fileId) {
  try {
    const buffer = await readFileContent(fileId);
    if (!buffer) return { error: 'No se pudo leer el archivo' };
    
    const gpxText = buffer.toString('utf8');
    
    const coords = [];
    const trkpts = gpxText.match(/<trkpt[^>]*>[\s\S]*?<\/trkpt>/g) || [];
    
    trkpts.forEach(trkpt => {
      const latMatch = trkpt.match(/lat="([^"]+)"/);
      const lonMatch = trkpt.match(/lon="([^"]+)"/);
      
      if (latMatch && lonMatch) {
        coords.push({
          lat: parseFloat(latMatch[1]),
          lon: parseFloat(lonMatch[1])
        });
      }
    });
    
    const distance = calculateDistance(coords);
    const bounds = coords.length > 0 ? {
      north: Math.max(...coords.map(c => c.lat)),
      south: Math.min(...coords.map(c => c.lat)),
      east: Math.max(...coords.map(c => c.lon)),
      west: Math.min(...coords.map(c => c.lon))
    } : null;
    
    return {
      totalPoints: coords.length,
      distance: distance.toFixed(1),
      bounds: bounds,
      googleMapsUrl: coords.length > 1 
        ? `https://www.google.com/maps/dir/${coords[0].lat},${coords[0].lon}/${coords[coords.length-1].lat},${coords[coords.length-1].lon}`
        : null,
      downloadUrl: `https://drive.google.com/uc?export=download&id=${fileId}`
    };
  } catch (error) {
    console.error('Error processing GPX:', error);
    return { error: error.message };
  }
}

// Calcular distancia entre coordenadas
function calculateDistance(coords) {
  if (coords.length < 2) return 0;
  
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const R = 6371;
    const dLat = (coords[i].lat - coords[i-1].lat) * Math.PI / 180;
    const dLon = (coords[i].lon - coords[i-1].lon) * Math.PI / 180;
    
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(coords[i-1].lat * Math.PI / 180) * 
              Math.cos(coords[i].lat * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    total += R * c;
  }
  
  return total;
}

// System Prompt
const SYSTEM_PROMPT = `Eres el asistente inteligente de O Gran Camiño 2025.

## TUS CAPACIDADES
Tienes acceso a archivos en Google Drive y puedes:
- Leer y analizar documentos
- Procesar archivos Excel con datos de hoteles, calendarios
- Analizar archivos GPX (rutas ciclistas)
- Generar enlaces a Google Maps
- Proporcionar información sobre PPO, hoteles, etapas

## CÓMO RESPONDER
- Usa HTML para formato: <strong>, <br>, <a href="..." target="_blank">
- Emojis relevantes: 🚴 🗺️ 🌤️ 📍 ⚠️ 📅 🚗
- Sé conciso pero completo
- Para direcciones, siempre genera link clickeable:
  🗺️ <a href="https://www.google.com/maps/search/?api=1&query=DIRECCION" target="_blank">Ver en Google Maps</a>
- Para rutas, genera link de navegación:
  🗺️ <a href="https://www.google.com/maps/dir/ORIGEN/DESTINO" target="_blank">Ver ruta completa</a>
- Para PPO (punto de salida), incluye dirección + hora + link a Maps

## IMPORTANTE
- Si preguntan por un archivo específico, diles qué archivos están disponibles
- Si necesitas leer un archivo, pide al usuario que te diga cuál específicamente
- Siempre incluye links clickeables`;

// Handler principal
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // GET /api/chat/files - Listar archivos
  if (req.method === 'GET' && req.url.includes('/files')) {
    try {
      const files = await listDriveFiles();
      
      const formattedFiles = files.map(f => ({
        id: f.id,
        name: f.name,
        type: f.mimeType.includes('spreadsheet') ? 'excel' :
              f.mimeType.includes('pdf') ? 'pdf' :
              f.name.endsWith('.gpx') ? 'gpx' :
              f.mimeType.includes('document') ? 'doc' : 'file',
        size: f.size,
        modified: f.modifiedTime,
        link: f.webViewLink
      }));
      
      return res.status(200).json({ files: formattedFiles });
    } catch (error) {
      console.error('Error:', error);
      return res.status(500).json({ error: 'Error al listar archivos' });
    }
  }
  
  // POST /api/chat/process-file - Procesar archivo
  if (req.method === 'POST' && req.url.includes('/process-file')) {
    try {
      const { fileId, fileType } = req.body;
      
      let result = null;
      
      if (fileType === 'excel') {
        result = await processExcel(fileId);
      } else if (fileType === 'gpx') {
        result = await processGPX(fileId);
      } else {
        const content = await readFileContent(fileId);
        result = { content: content ? content.toString('utf8').substring(0, 10000) : null };
      }
      
      return res.status(200).json({ data: result });
    } catch (error) {
      console.error('Error:', error);
      return res.status(500).json({ error: 'Error al procesar archivo' });
    }
  }
  
  // POST /api/chat - Enviar mensaje
  if (req.method === 'POST') {
    try {
      const { message, team, history = [] } = req.body;
      
      if (!message) {
        return res.status(400).json({ error: 'Mensaje requerido' });
      }
      
      const files = await listDriveFiles();
      let context = '\n## ARCHIVOS DISPONIBLES EN DRIVE:\n';
      files.forEach(file => {
        context += `- ${file.name}\n`;
      });
      
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 2048,
        system: SYSTEM_PROMPT + context,
        messages: [
          ...history.slice(-6),
          { role: 'user', content: message }
        ]
      });
      
      const responseText = response.content[0].text;
      
      console.log({
        timestamp: new Date().toISOString(),
        team,
        tokens: response.usage.input_tokens + response.usage.output_tokens,
        cost: ((response.usage.input_tokens * 3 + response.usage.output_tokens * 15) / 1000000).toFixed(4)
      });
      
      return res.status(200).json({
        response: responseText,
        tokensUsed: response.usage
      });
      
    } catch (error) {
      console.error('Error:', error);
      
      if (error.status === 401) {
        return res.status(500).json({ error: 'API key inválida' });
      }
      
      if (error.status === 429) {
        return res.status(429).json({ error: 'Demasiadas solicitudes' });
      }
      
      return res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
  
  return res.status(405).json({ error: 'Método no permitido' });
}