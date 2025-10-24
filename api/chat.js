import Anthropic from '@anthropic-ai/sdk';
import { google } from 'googleapis';
import XLSX from 'xlsx';
import pdf from 'pdf-parse';
import { parseStringPromise } from 'xml2js';
import mammoth from 'mammoth';

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
const fileCache = new Map();

// LECTURA EXCEL
async function downloadAndReadExcel(fileId) {
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
    console.error(`Error reading Excel:`, error.message);
    return null;
  }
}

// LECTURA GOOGLE SHEET
async function downloadAndReadGoogleSheet(sheetId) {
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
    console.error(`Error reading Google Sheet:`, error.message);
    return null;
  }
}

// LECTURA GOOGLE DOC
async function downloadAndReadGoogleDoc(docId) {
  try {
    const response = await drive.files.export(
      { fileId: docId, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      { responseType: 'arraybuffer' }
    );
    const result = await mammoth.extractRawText({ arrayBuffer: response.data });
    return { text: result.value, source: 'GoogleDoc' };
  } catch (error) {
    console.error(`Error reading Google Doc:`, error.message);
    return null;
  }
}

// LECTURA WORD
async function downloadAndReadWord(fileId) {
  try {
    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    const result = await mammoth.extractRawText({ arrayBuffer: response.data });
    return { text: result.value, source: 'Word' };
  } catch (error) {
    console.error(`Error reading Word:`, error.message);
    return null;
  }
}

// LECTURA PDF
async function downloadAndReadPDF(fileId) {
  try {
    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    const data = await pdf(Buffer.from(response.data));
    return { text: data.text, pages: data.numpages, source: 'PDF' };
  } catch (error) {
    console.error(`Error reading PDF:`, error.message);
    return null;
  }
}

// LECTURA GPX
async function downloadAndReadGPX(fileId) {
  try {
    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    const gpxText = Buffer.from(response.data).toString('utf-8');
    const gpxData = await parseStringPromise(gpxText);
    
    const result = {
      type: 'GPX',
      trackpoints: [],
      waypoints: [],
      elevation: { min: Infinity, max: -Infinity },
      bounds: {},
      source: 'GPX'
    };
    
    if (gpxData.gpx?.trk) {
      gpxData.gpx.trk.forEach(track => {
        if (track.trkseg) {
          track.trkseg.forEach(segment => {
            if (segment.trkpt) {
              segment.trkpt.forEach(point => {
                const ele = parseFloat(point.ele?.[0] || 0);
                result.trackpoints.push({
                  lat: parseFloat(point.$.lat),
                  lon: parseFloat(point.$.lon),
                  ele: ele
                });
                if (ele) {
                  result.elevation.min = Math.min(result.elevation.min, ele);
                  result.elevation.max = Math.max(result.elevation.max, ele);
                }
              });
            }
          });
        }
      });
    }
    
    if (gpxData.gpx?.wpt) {
      gpxData.gpx.wpt.forEach(point => {
        result.waypoints.push({
          name: point.name?.[0],
          lat: parseFloat(point.$.lat),
          lon: parseFloat(point.$.lon)
        });
      });
    }
    
    if (gpxData.gpx?.bounds?.[0]) {
      const b = gpxData.gpx.bounds[0].$;
      result.bounds = {
        minlat: parseFloat(b.minlat),
        minlon: parseFloat(b.minlon),
        maxlat: parseFloat(b.maxlat),
        maxlon: parseFloat(b.maxlon)
      };
    }
    
    return result;
  } catch (error) {
    console.error(`Error reading GPX:`, error.message);
    return null;
  }
}

// LECTURA KML
async function downloadAndReadKML(fileId) {
  try {
    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    const kmlText = Buffer.from(response.data).toString('utf-8');
    const kmlData = await parseStringPromise(kmlText);
    return { type: 'KML', data: kmlData, source: 'KML' };
  } catch (error) {
    console.error(`Error reading KML:`, error.message);
    return null;
  }
}

// PROCESAR ARCHIVO
async function processFileContent(file) {
  try {
    if (file.mimeType.includes('google-apps.spreadsheet')) {
      return await downloadAndReadGoogleSheet(file.id);
    }
    if (file.mimeType.includes('google-apps.document')) {
      return await downloadAndReadGoogleDoc(file.id);
    }
    if (file.mimeType.includes('spreadsheet') || file.name.match(/\.(xlsx?|xls)$/i)) {
      return await downloadAndReadExcel(file.id);
    }
    if (file.mimeType.includes('wordprocessingml') || file.name.endsWith('.docx')) {
      return await downloadAndReadWord(file.id);
    }
    if (file.mimeType.includes('pdf') || file.name.endsWith('.pdf')) {
      return await downloadAndReadPDF(file.id);
    }
    if (file.name.endsWith('.gpx')) {
      return await downloadAndReadGPX(file.id);
    }
    if (file.name.endsWith('.kml')) {
      return await downloadAndReadKML(file.id);
    }
    return null;
  } catch (error) {
    console.error(`Error processing ${file.name}:`, error.message);
    return null;
  }
}

// LISTAR ARCHIVOS
async function listDriveFiles(folderId = MAIN_FOLDER_ID) {
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
    console.error('Error listing files:', error.message);
    return [];
  }
}

const SYSTEM_PROMPT = `Eres el asistente inteligente de O Gran Camiño 2025.

## REGLAS
1. **NUNCA inventes datos** - Solo usa archivos
2. Responde en HTML elegante
3. Lee PDF, Docs, Excel, Sheets completo
4. Extrae GPX: coordenadas, elevación, distancia
5. Si falta info, dilo claramente

## FORMATO RESPUESTAS

TABLAS:
<h3>🏨 Hoteles O Gran Camiño 2025</h3>
<table style="width:100%; border-collapse:collapse;">
  <tr style="background:#667eea; color:white;">
    <th style="padding:10px; border:1px solid #ddd;">Equipo</th>
    <th style="padding:10px; border:1px solid #ddd;">Hotel</th>
  </tr>
  <tr>
    <td style="padding:10px; border:1px solid #ddd;">Movistar</td>
    <td style="padding:10px; border:1px solid #ddd;">Feel Viana</td>
  </tr>
</table>

RUTAS (GPX):
<h3>🗺️ Etapa - Ruta</h3>
<p><strong>Puntos:</strong> [número]</p>
<p><strong>Elevación:</strong> [m min] - [m max]</p>
<p><strong>Inicio:</strong> Lat, Lon</p>

EMOJIS: 🚴 🗺️ 🏨 📍 ⚠️ 📅`;

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
              f.mimeType.includes('google-apps.spreadsheet') ? 'sheet' :
              f.mimeType.includes('google-apps.document') ? 'doc' :
              f.mimeType.includes('wordprocessingml') ? 'word' :
              f.mimeType.includes('pdf') ? 'pdf' :
              f.name.match(/\.(gpx|kml)$/i) ? 'track' : 'file',
        size: f.size
      }));
      return res.status(200).json({ success: true, files: formattedFiles });
    }
    
    if (req.method === 'POST') {
      const { message, team, history = [] } = req.body;
      if (!message) {
        return res.status(400).json({ success: false, error: 'Mensaje requerido' });
      }
      
      const files = await listDriveFiles();
      let context = '\n## INFORMACIÓN DISPONIBLE:\n\n';
      let fileCount = 0;
      
      for (const file of files) {
        const cacheKey = `content_${file.id}`;
        let content = null;
        
        if (fileCache.has(cacheKey)) {
          const cached = fileCache.get(cacheKey);
          if (Date.now() - cached.timestamp < 30 * 60 * 1000) {
            content = cached.data;
          }
        }
        
        if (!content) {
          content = await processFileContent(file);
          if (content) {
            fileCache.set(cacheKey, { data: content, timestamp: Date.now() });
          }
        }
        
        if (content) {
          fileCount++;
          context += `\n### 📄 ${file.name}\n`;
          const contentStr = JSON.stringify(content);
          if (contentStr.length > 50000) {
            context += contentStr.substring(0, 5000) + '...\n';
          } else {
            context += contentStr + '\n';
          }
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
        tokensUsed: response.usage,
        filesProcessed: fileCount
      });
    }
    
    return res.status(405).json({ success: false, error: 'Método no permitido' });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}