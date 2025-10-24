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
      scopes: [
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/spreadsheets.readonly'
      ]
    });
    drive = google.drive({ version: 'v3', auth });
  }
} catch (error) {
  console.error('Google Auth error:', error.message);
}

const MAIN_FOLDER_ID = process.env.DRIVE_FOLDER_ID || '1LMhvJktYAvY9MISgaQipiiCnttM838Sj';
const fileCache = new Map();

// EXCEL
async function readExcel(fileId) {
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
    console.error(`Error Excel:`, error.message);
    return null;
  }
}

// GOOGLE SHEET
async function readGoogleSheet(sheetId) {
  try {
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
    console.error(`Error Sheet:`, error.message);
    return null;
  }
}

// GOOGLE DOC
async function readGoogleDoc(docId) {
  try {
    const response = await drive.files.export(
      { fileId: docId, mimeType: 'text/plain' },
      { responseType: 'arraybuffer' }
    );
    const text = Buffer.from(response.data).toString('utf-8');
    return { text, type: 'GoogleDoc' };
  } catch (error) {
    console.error(`Error GoogleDoc:`, error.message);
    return null;
  }
}

// GPX (parser simple)
async function readGPX(fileId) {
  try {
    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    const gpxText = Buffer.from(response.data).toString('utf-8');
    
    const result = {
      type: 'GPX',
      trackpoints: [],
      waypoints: [],
      elevation: { min: Infinity, max: -Infinity }
    };
    
    // Trackpoints
    const trkptRegex = /<trkpt lat="([\d.-]+)" lon="([\d.-]+)">[\s\S]*?<ele>([\d.-]+)<\/ele>/g;
    let match;
    while ((match = trkptRegex.exec(gpxText)) !== null) {
      const ele = parseFloat(match[3]);
      result.trackpoints.push({
        lat: parseFloat(match[1]),
        lon: parseFloat(match[2]),
        ele: ele
      });
      result.elevation.min = Math.min(result.elevation.min, ele);
      result.elevation.max = Math.max(result.elevation.max, ele);
    }
    
    // Waypoints
    const wptRegex = /<wpt lat="([\d.-]+)" lon="([\d.-]+)">[\s\S]*?<name>(.*?)<\/name>/g;
    while ((match = wptRegex.exec(gpxText)) !== null) {
      result.waypoints.push({
        name: match[3],
        lat: parseFloat(match[1]),
        lon: parseFloat(match[2])
      });
    }
    
    return result;
  } catch (error) {
    console.error(`Error GPX:`, error.message);
    return null;
  }
}

// KML
async function readKML(fileId) {
  try {
    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    const kmlText = Buffer.from(response.data).toString('utf-8');
    return { text: kmlText, type: 'KML' };
  } catch (error) {
    console.error(`Error KML:`, error.message);
    return null;
  }
}

// PROCESAR ARCHIVO
async function processFile(file) {
  try {
    if (file.mimeType.includes('google-apps.spreadsheet')) {
      return await readGoogleSheet(file.id);
    }
    if (file.mimeType.includes('google-apps.document')) {
      return await readGoogleDoc(file.id);
    }
    if (file.mimeType.includes('spreadsheet') || file.name.match(/\.(xlsx?|xls)$/i)) {
      return await readExcel(file.id);
    }
    if (file.name.endsWith('.gpx')) {
      return await readGPX(file.id);
    }
    if (file.name.endsWith('.kml')) {
      return await readKML(file.id);
    }
    return null;
  } catch (error) {
    console.error(`Error processing:`, error.message);
    return null;
  }
}

// LISTAR ARCHIVOS
async function listFiles(folderId = MAIN_FOLDER_ID) {
  if (!drive) return [];
  const cacheKey = `files_${folderId}`;
  if (fileCache.has(cacheKey)) {
    const cached = fileCache.get(cacheKey);
    if (Date.now() - cached.timestamp < 10 * 60 * 1000) return cached.data;
  }
  try {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id, name, mimeType, webViewLink, size, modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: 100
    });
    const files = response.data.files || [];
    fileCache.set(cacheKey, { data: files, timestamp: Date.now() });
    return files;
  } catch (error) {
    console.error('Error listing:', error.message);
    return [];
  }
}

const SYSTEM_PROMPT = `Eres el asistente de O Gran Camiño 2025.

REGLAS:
1. **NUNCA inventes datos** - solo usa archivos
2. Responde en HTML elegante
3. Para descargas: dile usuario que descargue desde Drive
4. Si falta info, dilo claro

Responde siempre formateado con tablas y emojis.`;

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
      const files = await listFiles();
      const formatted = files.map(f => ({
        id: f.id,
        name: f.name,
        type: f.name.endsWith('.gpx') ? 'gpx' : f.name.endsWith('.kml') ? 'kml' : 'file',
        link: f.webViewLink
      }));
      return res.status(200).json({ success: true, files: formatted });
    }
    
    if (req.method === 'POST') {
      const { message, team, history = [] } = req.body;
      if (!message) {
        return res.status(400).json({ success: false, error: 'Mensaje requerido' });
      }
      
      const files = await listFiles();
      let context = '\n## ARCHIVOS:\n\n';
      let count = 0;
      
      for (const file of files) {
        const key = `content_${file.id}`;
        let content = fileCache.get(key)?.data;
        
        if (!content) {
          content = await processFile(file);
          if (content) {
            fileCache.set(key, { data: content, timestamp: Date.now() });
          }
        }
        
        if (content) {
          count++;
          context += `\n### ${file.name}\n${JSON.stringify(content)}\n`;
        }
      }
      
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 2048,
        system: SYSTEM_PROMPT + context,
        messages: [...history.slice(-8), { role: 'user', content: message }]
      });
      
      return res.status(200).json({
        success: true,
        response: response.content[0].text,
        filesProcessed: count
      });
    }
    
    return res.status(405).json({ success: false, error: 'No permitido' });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}