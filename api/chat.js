import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const SYSTEM_PROMPT = `Eres el asistente inteligente de O Gran Camiño 2025.

## REGLA CRÍTICA
**NO INVENTES DATOS.** Solo usa exactamente lo que está en la base de datos.
Si la información no está disponible, dilo claramente.

## FORMATO DE RESPUESTAS

SIEMPRE en HTML elegante:

<h3>🏨 Hoteles O Gran Camiño 2025</h3>
<table style="width:100%; border-collapse:collapse;">
  <tr style="background:#667eea; color:white;">
    <th style="padding:10px; text-align:left; border:1px solid #ddd;">Etapa</th>
    <th style="padding:10px; text-align:left; border:1px solid #ddd;">Fecha</th>
    <th style="padding:10px; text-align:left; border:1px solid #ddd;">Hotel</th>
    <th style="padding:10px; text-align:left; border:1px solid #ddd;">Ciudad</th>
  </tr>
  <tr>
    <td style="padding:10px; border:1px solid #ddd;">Etapa 1</td>
    <td style="padding:10px; border:1px solid #ddd;">26 Feb</td>
    <td style="padding:10px; border:1px solid #ddd;">Feel Viana</td>
    <td style="padding:10px; border:1px solid #ddd;">Viana do Castelo</td>
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
    // GET /api/chat/files - Devuelve archivos disponibles desde Supabase Storage
    if (req.method === 'GET' && req.url.includes('/files')) {
      const { data, error } = await supabase
        .from('documents')
        .select('*');
      
      if (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
      
      const files = (data || []).map(doc => ({
        id: doc.id,
        name: doc.name,
        type: doc.doc_type,
        storage_path: doc.storage_path
      }));
      
      return res.status(200).json({ success: true, files });
    }
    
    // POST /api/chat - Chat con contexto de Supabase
    if (req.method === 'POST') {
      const { message, team, history = [] } = req.body;
      
      if (!message) {
        return res.status(400).json({ success: false, error: 'Mensaje requerido' });
      }
      
      let teamId = null;
      
      // Obtener team_id por código (team ya llega con código completo: UNOX2025)
      if (team !== 'public') {
        const { data: teamData } = await supabase
          .from('teams')
          .select('id')
          .eq('code', team)
          .single();
        
        teamId = teamData?.id;
        
        if (!teamId) {
          return res.status(400).json({ 
            success: false, 
            error: `Equipo no encontrado: ${team}` 
          });
        }
      }
      
      // Construir contexto desde Supabase
      let context = '\n## DATOS DE O GRAN CAMIÑO 2025:\n\n';
      
      // Hotels para este equipo (si está autenticado)
      if (teamId) {
        const { data: hotels, error: hotelsError } = await supabase
          .from('hotels')
          .select(`
            stage_id,
            hotel_name,
            city,
            address,
            stages(stage_number, date, start_location, finish_location, distance_km)
          `)
          .eq('team_id', teamId)
          .order('stage_id');
        
        if (hotelsError) {
          console.error('Error fetching hotels:', hotelsError);
        } else if (hotels && hotels.length > 0) {
          context += '### 🏨 HOTELES POR ETAPA:\n';
          hotels.forEach(h => {
            const dateFormatted = new Date(h.stages.date).toLocaleDateString('es-ES', { 
              day: '2-digit', 
              month: 'short' 
            });
            context += `- Etapa ${h.stages.stage_number} (${dateFormatted}): ${h.hotel_name}, ${h.city}\n`;
          });
        }
      }
      
      // Stages (público)
      const { data: stages, error: stagesError } = await supabase
        .from('stages')
        .select('*')
        .order('stage_number');
      
      if (stagesError) {
        console.error('Error fetching stages:', stagesError);
      } else if (stages && stages.length > 0) {
        context += '\n### 📅 ETAPAS:\n';
        stages.forEach(s => {
          const dateFormatted = new Date(s.date).toLocaleDateString('es-ES', { 
            day: '2-digit', 
            month: 'short' 
          });
          context += `- Etapa ${s.stage_number} (${dateFormatted}): ${s.start_location} → ${s.finish_location} (${s.distance_km}km)\n`;
        });
      }
      
      // Incidents
      const { data: incidents, error: incidentsError } = await supabase
        .from('incidents')
        .select('*, stages(stage_number, date)')
        .order('created_at', { ascending: false })
        .limit(10);
      
      if (incidentsError) {
        console.error('Error fetching incidents:', incidentsError);
      } else if (incidents && incidents.length > 0) {
        context += '\n### ⚠️ INCIDENCIAS RECIENTES:\n';
        incidents.forEach(i => {
          context += `- Etapa ${i.stages.stage_number}: ${i.description}\n`;
        });
      }
      
      // Documents - CON URLs CORRECTAS HARDCODEADAS
      const { data: documents, error: docsError } = await supabase
        .from('documents')
        .select('*');
      
      if (docsError) {
        console.error('Error fetching documents:', docsError);
      } else if (documents && documents.length > 0) {
        context += '\n### 📄 DOCUMENTOS DISPONIBLES:\n';
        
        // URLs hardcodeadas correctas para los PDFs
        const PDF_URLS = {
          'Roadbook': 'https://nalikmbbscebdoldwmki.supabase.co/storage/v1/object/public/race-files/PDFS/Libro_de-ruta-25.pdf',
          'Media Book': 'https://nalikmbbscebdoldwmki.supabase.co/storage/v1/object/public/race-files/PDFS/mediabook.pdf',
          'Regulations': 'https://nalikmbbscebdoldwmki.supabase.co/storage/v1/object/public/race-files/PDFS/reglamento.pdf'
        };
        
        documents.forEach(d => {
          // Usar URL hardcodeada si existe, si no usar storage_path
          const correctUrl = PDF_URLS[d.name] || `${process.env.SUPABASE_URL}/storage/v1/object/public/race-files${d.storage_path}`;
          context += `- ${d.name}: ${correctUrl}\n`;
        });
      }
      
      const fullPrompt = SYSTEM_PROMPT + context;
      
      console.log('Chat request:', {
        messageLength: message.length,
        contextLength: context.length,
        teamId,
        team
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
    console.error('Error en API:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message
    });
  }
}