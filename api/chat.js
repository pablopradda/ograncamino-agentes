import Anthropic from '@anthropic-ai/sdk';
import { google } from 'googleapis';
import XLSX from 'xlsx';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

let auth = null;
let drive = null;

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
      scopes: ['https://www.googleapis.com/auth/drive.readonly']
    });
    drive = google.drive({ version: 'v3', auth });
  }
} catch (error) {
  console.error('Drive init error:', error.message);
}

const MAIN_FOLDER_ID = process.env.DRIVE_FOLDER_ID || '1LMhvJktYAvY9MISgaQipiiCnttM838Sj';
const cache = new Map();

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

const SYSTEM_PROMPT = `Eres el asistente inteligente de O Gran Camiño 2025.

Tienes acceso a archivos en Google Drive y puedes:
- Leer y analizar documentos
- Procesar archivos Excel
- Analizar archivos GPX (rutas)
- Generar enlaces a Google Maps
- Proporcionar información sobre PPO, hoteles, etapas

Responde siempre en HTML con emojis relevantes.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    if (req.method === 'GET' && req.url.includes('/files')) {
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
      return res.status(200).json({ success: true, files: formattedFiles });
    }
    
    if (req.method === 'POST') {
      const { message, team, history = [] } = req.body;
      
      if (!message) {
        return res.status(400).json({ success: false, error: 'Mensaje requerido' });
      }
      
      const files = await listDriveFiles();
      let context = '\n## ARCHIVOS DISPONIBLES EN DRIVE:\n';
      if (files.length > 0) {
        files.forEach(file => {
          context += `- ${file.name}\n`;
        });
      } else {
        context += '- (No hay archivos disponibles)\n';
      }
      
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
      
      return res.status(200).json({
        success: true,
        response: responseText,
        tokensUsed: response.usage
      });
    }
    
    return res.status(405).json({ success: false, error: 'Método no permitido' });
    
  } catch (error) {
    console.error('Error:', error.message);
    return res.status(500).json({ 
      success: false, 
      error: error.message || 'Error interno del servidor'
    });
  }
}