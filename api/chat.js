import Anthropic from '@anthropic-ai/sdk';
import { google } from 'googleapis';
import XLSX from 'xlsx';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

let auth = null;
let drive = null;
let sheets = null;

try {
  let credentials = null;
  if (process.env.GOOGLE_SERVICE_ACCOUNT) {
    try {
      credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    } catch (e) {
      try {
        credentials = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT, 'base64').toString());
      } catch (e2) {
        credentials = null;
      }
    }
  }
  if (credentials && credentials.type === 'service_account') {
    auth = new google.auth.GoogleAuth({
      credentials: credentials,
      scopes: [
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/spreadsheets.readonly'
      ]
    });
    drive = google.drive({ version: 'v3', auth });
    sheets = google.sheets({ version: 'v4', auth });
  }
} catch (error) {
  console.error('Google Auth error:', error.message);
}

const MAIN_FOLDER_ID = process.env.DRIVE_FOLDER_ID || '1LMhvJktYAvY9MISgaQipiiCnttM838Sj';
const cache = new Map();

// Leer Google Sheet
async function readGoogleSheet(sheetId, sheetName = 'Hoja1') {
  if (!sheets) return null;
  
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'${sheetName}'`
    });
    
    const rows = response.data.values;
    if (!rows || rows.length === 0) return null;
    
    const headers = rows[0];
    const data = rows.slice(1).map(row => {
      const obj = {};
      headers.forEach((header, i) => {
        obj[header] = row[i] || '';
      });
      return obj;
    });
    
    return data;
  } catch (error) {
    console.error('Error reading sheet:', error.message);
    return null;
  }
}

// Listar archivos de Drive
async function listDriveFiles(folderId = MAIN_FOLDER_ID) {
  if (!drive) return [];
  
  const cacheKey = `files_${folderId}`;
  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey);
    if (Date.now() - cached.timestamp < 5 * 60 * 1000) return cached.data;
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
    console.error('Error listing files:', error.message);
    return [];
  }
}

// Procesar contenido de archivo
async function processFileContent(fileId, mimeType) {
  if (!drive) return null;
  
  try {
    // Si es Google Sheet, extraer ID y leer
    if (mimeType.includes('google-apps.spreadsheet')) {
      const sheetData = await readGoogleSheet(fileId, 'Hoja1');
      return sheetData;
    }
    
    // Si es Excel
    if (mimeType.includes('spreadsheet')) {
      const response = await drive.files.get(
        { fileId: fileId, alt: 'media' },
        { responseType: 'arraybuffer' }
      );
      const workbook = XLSX.read(Buffer.from(response.data), { type: 'buffer' });
      const result = {};
      workbook.SheetNames.forEach(sheetName => {
        result[sheetName] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
      });
      return result;
    }
    
    return null;
  } catch (error) {
    console.error('Error processing file:', error.message);
    return null;
  }
}

// System Prompt
const SYSTEM_PROMPT = `Eres el asistente inteligente de O Gran Camiño 2025.

## INFORMACIÓN DISPONIBLE EN LOS ARCHIVOS

- 🏨 Hoteles por equipo y etapa
- 🚴 Lista de equipos participantes
- 📅 Calendarios y horarios
- 🗺️ Rutas GPX y etapas
- 📍 Puntos de partida oficial (PPO)

## INSTRUCCIONES DE RESPUESTA

SIEMPRE formatea las respuestas en HTML elegante y profesional:

PARA TABLAS (equipos, hoteles, etc):
<h3>🏨 Hoteles - O Gran Camiño 2025</h3>
<table style="width:100%; border-collapse:collapse; margin:10px 0;">
  <tr style="background:#667eea; color:white;">
    <th style="border:1px solid #ddd; padding:10px; text-align:left;">Equipo</th>
    <th style="border:1px solid #ddd; padding:10px; text-align:left;">Etapa 1</th>
    <th style="border:1px solid #ddd; padding:10px; text-align:left;">Etapa 2</th>
  </tr>
  <tr style="background:#f9f9f9;">
    <td style="border:1px solid #ddd; padding:10px;"><strong>Movistar</strong></td>
    <td style="border:1px solid #ddd; padding:10px;">Hotel A</td>
    <td style="border:1px solid #ddd; padding:10px;">Hotel B</td>
  </tr>
</table>

PARA LISTAS:
<h3>🚴 Equipos Participantes</h3>
<ul>
  <li><strong>Equipo 1</strong> - País</li>
  <li><strong>Equipo 2</strong> - País</li>
</ul>

PARA INFORMACIÓN DETALLADA:
<h3>📍 PPO Etapa 5</h3>
<p><strong>Localización:</strong> Padrón</p>
<p><strong>Hora:</strong> 08:00</p>
<p><strong>Fecha:</strong> 23 de febrero de 2025</p>
<p><a href="https://www.google.com/maps/search/Padron" target="_blank">🗺️ Ver ubicación en Google Maps</a></p>

## REGLAS IMPORTANTES

- Responde SIEMPRE en HTML
- Usa emojis relevantes: 🚴 🗺️ 🏨 📍 ⚠️ 📅 🌤️ 🚗
- Mantén respuestas concisas pero informativas
- Para direcciones: genera link a Google Maps
- Si preguntan por algo que no tienes en los archivos, dilo claramente
- NO INVENTES DATOS - solo usa lo que está en los archivos
- Sé profesional y amable`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    // GET /api/chat/files - Listar archivos
    if (req.method === 'GET' && req.url.includes('/files')) {
      const files = await listDriveFiles();
      
      const formattedFiles = files.map(f => ({
        id: f.id,
        name: f.name,
        type: f.mimeType.includes('spreadsheet') ? 'excel' :
              f.mimeType.includes('google-apps.spreadsheet') ? 'sheet' :
              f.mimeType.includes('pdf') ? 'pdf' :
              f.name.endsWith('.gpx') ? 'gpx' :
              f.mimeType.includes('document') ? 'doc' : 'file',
        size: f.size,
        modified: f.modifiedTime,
        link: f.webViewLink,
        mimeType: f.mimeType
      }));
      
      return res.status(200).json({ success: true, files: formattedFiles });
    }
    
    // POST /api/chat - Enviar mensaje
    if (req.method === 'POST') {
      const { message, team, history = [] } = req.body;
      
      if (!message) {
        return res.status(400).json({ success: false, error: 'Mensaje requerido' });
      }
      
      // Obtener archivos de Drive
      const files = await listDriveFiles();
      let context = '\n## ARCHIVOS DISPONIBLES EN DRIVE:\n\n';
      
      // Procesar cada archivo
      for (const file of files) {
        context += `📄 **${file.name}**\n`;
        
        try {
          const fileContent = await processFileContent(file.id, file.mimeType);
          
          if (fileContent) {
            if (Array.isArray(fileContent)) {
              // Es un array de objetos (Google Sheet o Excel)
              context += JSON.stringify(fileContent.slice(0, 50), null, 2) + '\n\n';
            } else if (typeof fileContent === 'object') {
              // Es un objeto
              context += JSON.stringify(fileContent, null, 2) + '\n\n';
            }
          }
        } catch (error) {
          console.error(`Error processing ${file.name}:`, error.message);
        }
      }
      
      // Crear mensaje para Claude
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
        tokens: response.usage.input_tokens + response.usage.output_tokens
      });
      
      return res.status(200).json({
        success: true,
        response: responseText,
        tokensUsed: response.usage
      });
    }
    
    return res.status(405).json({ success: false, error: 'Método no permitido' });
    
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message || 'Error interno del servidor'
    });
  }
}