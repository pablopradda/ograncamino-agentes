import Anthropic from '@anthropic-ai/sdk';
import { google } from 'googleapis';
import XLSX from 'xlsx';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

let auth = null, drive = null;

try {
  let creds = null;
  if (process.env.GOOGLE_SERVICE_ACCOUNT) {
    try { creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT); } 
    catch { creds = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT, 'base64').toString()); }
  }
  if (creds?.type === 'service_account') {
    auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/spreadsheets.readonly']
    });
    drive = google.drive({ version: 'v3', auth });
  }
} catch (e) { console.error('Auth error:', e.message); }

const FOLDER_ID = '1LMhvJktYAvY9MISgaQipiiCnttM838Sj';
const cache = new Map();

async function readSpreadsheet(id, isGoogleSheet = false) {
  try {
    const res = isGoogleSheet 
      ? await drive.files.export({ fileId: id, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, { responseType: 'arraybuffer' })
      : await drive.files.get({ fileId: id, alt: 'media' }, { responseType: 'arraybuffer' });
    
    const wb = XLSX.read(new Uint8Array(res.data), { type: 'array' });
    const result = {};
    wb.SheetNames.forEach(sn => {
      result[sn] = XLSX.utils.sheet_to_json(wb.Sheets[sn]);
    });
    return result;
  } catch (e) {
    console.error('Error reading spreadsheet:', e.message);
    return null;
  }
}

async function listFiles() {
  const key = `files`;
  if (cache.has(key) && Date.now() - cache.get(key).t < 600000) return cache.get(key).d;
  
  try {
    const res = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(id, name, mimeType)',
      pageSize: 100
    });
    const files = res.data.files || [];
    cache.set(key, { d: files, t: Date.now() });
    return files;
  } catch (e) {
    console.error('Error listing files:', e.message);
    return [];
  }
}

function getDownloadUrl(fileId) {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  try {
    if (req.method === 'GET' && req.url.includes('/files')) {
      const files = await listFiles();
      const formatted = files.map(f => ({
        id: f.id,
        name: f.name,
        type: f.name.match(/\.gpx$/i) ? 'gpx' : f.name.match(/\.kmz?$/i) ? 'kml' : 'file',
        downloadUrl: f.name.match(/\.(gpx|kmz?|xlsx?|xls)$/i) ? getDownloadUrl(f.id) : null
      }));
      return res.json({ success: true, files: formatted });
    }
    
    if (req.method === 'POST') {
      const { message, history = [] } = req.body;
      if (!message) return res.status(400).json({ success: false, error: 'Mensaje requerido' });
      
      const files = await listFiles();
      
      const dataFiles = [];
      const trackFiles = [];
      
      for (const file of files) {
        if (file.name.match(/\.(xlsx?|xls)$/i) || file.mimeType.includes('spreadsheet')) {
          dataFiles.push(file);
        } else if (file.name.match(/\.(gpx|kmz?)$/i)) {
          trackFiles.push(file);
        }
      }
      
      let context = '\n## DATOS DISPONIBLES:\n\n';
      
      for (const file of dataFiles) {
        const cacheKey = `file_${file.id}`;
        let content = cache.get(cacheKey)?.d;
        
        if (!content) {
          const isSheet = file.mimeType.includes('google-apps.spreadsheet');
          const isExcel = file.mimeType.includes('spreadsheet') || file.name.match(/\.xlsx?$/i);
          
          if (isSheet || isExcel) {
            content = await readSpreadsheet(file.id, isSheet);
            cache.set(cacheKey, { d: content, t: Date.now() });
          }
        }
        
        if (content) {
          context += `### 📊 ${file.name}\n${JSON.stringify(content)}\n\n`;
        }
      }
      
      if (trackFiles.length > 0) {
        context += '\n## ARCHIVOS DESCARGABLES (Rutas):\n\n';
        trackFiles.forEach(file => {
          const type = file.name.match(/\.gpx$/i) ? 'GPX' : 'KML/KMZ';
          context += `- 🗺️ ${file.name} (${type}): ${getDownloadUrl(file.id)}\n`;
        });
      }
      
      const systemPrompt = `Eres asistente de O Gran Camiño 2025.
REGLAS:
1. Solo datos que ves arriba
2. Si hay links de descarga, menciónalos
3. NO inventes
4. Si no está, dices "No tengo esa información"
Responde en HTML elegante.`;
      
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 2048,
        system: systemPrompt + context,
        messages: [...history.slice(-8), { role: 'user', content: message }]
      });
      
      return res.json({ success: true, response: response.content[0].text });
    }
    
    return res.status(405).json({ success: false });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}