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

// Descargar y leer Excel
async function downloadAndReadExcel(fileId) {
  if (!drive) return null;
  
  try {
    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    
    const workbook = XLSX.read(new Uint8Array(response.data), { type: 'array' });
    const result = {};
    
    workbook.SheetNames.forEach(sheetName => {
      result[sheetName] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
    });
    
    return result;
  } catch (error) {
    console.error(`Error downloading Excel ${fileId}:`, error.message);
    return null;
  }
}

// Exportar y leer Google Sheet como Excel
async function downloadAndReadGoogleSheet(sheetId) {
  if (!drive) return null;
  
  try {
    // Exportar como Excel
    const response = await drive.files.export(
      { fileId: sheetId, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      { responseType: 'arraybuffer' }
    );
    
    const workbook = XLSX.read(new Uint8Array(response.data), { type: 'array' });
    const result = {};
    
    workbook.SheetNames.forEach(sheetName => {
      result[sheetName] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
    });
    
    return result;
  } catch (error) {
    console.error(`Error downloading Google Sheet ${sheetId}:`, error.message);
    return null;
  }
}

// Procesar archivo
async function processFileContent(file) {
  try {
    // Google Sheet
    if (file.mimeType.includes('google-apps.spreadsheet')) {
      console.log(`Reading Google Sheet: ${file.name}`);
      return await downloadAndReadGoogleSheet(file.id);
    }
    
    // Excel
    if (file.mimeType.includes('spreadsheet') || file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
      console.log(`Reading Excel: ${file.name}`);
      return await downloadAndReadExcel(file.id);
    }
    
    return null;
  } catch (error) {
    console.error(`Error processing ${file.name}:`, error.message);
    return null;
  }
}

// Listar archivos
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

// System Prompt
const SYSTEM_PROMPT = `Eres el asistente inteligente de O Gran Camiño 2025.

## REGLA CRÍTICA
**NO INVENTES DATOS.** Solo usa exactamente lo que está en los archivos.
Si la información no está disponible, dilo claramente.

## FORMATO DE RESPUESTAS

SIEMPRE en HTML elegante:

<h3>🏨 Hoteles O Gran Camiño 2025</h3>
<table style="width:100%; border-collapse:collapse;">
  <tr style="background:#667eea; color:white;">
    <th style="padding:10px; text-align:left; border:1px solid #ddd;">Equipo</th>
    <th style="padding:10px; text-align:left; border:1px solid #ddd;">Etapa 1</th>
  </tr>
  <tr>
    <td style="padding:10px; border:1px solid #ddd;">Movistar</td>
    <td style="padding:10px; border:1px solid #ddd;">Feel Viana</td>
  </tr>
</table>

EMOJIS: 🚴 🗺️ 🏨 📍 ⚠️ 📅 🌤️ 🚗
`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    // GET /api/chat/files
    if (req.method === 'GET' && req.url.includes('/files')) {
      const files = await listDriveFiles();
      
      const formattedFiles = files.map(f => ({
        id: f.id,
        name: f.name,
        type: f.mimeType.includes('spreadsheet') ? 'excel' :
              f.mimeType.includes('google-apps.spreadsheet') ? 'sheet' :
              f.name.endsWith('.gpx') ? 'gpx' : 'file',
        mimeType: f.mimeType
      }));
      
      return res.status(200).json({ success: true, files: formattedFiles });
    }
    
    // POST /api/chat
    if (req.method === 'POST') {
      const { message, team, history = [] } = req.body;
      
      if (!message) {
        return res.status(400).json({ success: false, error: 'Mensaje requerido' });
      }
      
      // Obtener archivos
      const files = await listDriveFiles();
      let context = '\n## DATOS DISPONIBLES EN DRIVE:\n\n';
      
      // Leer TODOS los archivos
      for (const file of files) {
        const content = await processFileContent(file);
        
        if (content) {
          context += `\n### ${file.name}\n`;
          context += JSON.stringify(content, null, 2);
        } else {
          context += `\n### ${file.name} - [No se pudo leer]\n`;
        }
      }
      
      // Crear prompt
      const fullPrompt = SYSTEM_PROMPT + context;
      
      console.log('Sending to Claude:', {
        messageLength: message.length,
        contextLength: context.length,
        files: files.length
      });
      
      // Llamar a Claude
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 2048,
        system: fullPrompt,
        messages: [
          ...history.slice(-6),
          { role: 'user', content: message }
        ]
      });
      
      const responseText = response.content[0].text;
      
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
      error: error.message
    });
  }
}