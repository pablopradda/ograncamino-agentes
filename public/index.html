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
    <th style="padding:10px; text-align:left; border:1px solid #ddd;">Hotel</th>
  </tr>
  <tr>
    <td style="padding:10px; border:1px solid #ddd;">Etapa 1</td>
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
      
      // Obtener team_id
      const { data: teamData } = await supabase
        .from('teams')
        .select('id')
        .eq('code', team === 'public' ? 'MOVISTAR2025' : `${team.toUpperCase()}2025`)
        .single();
      
      const teamId = teamData?.id || 1;
      
      // Construir contexto desde Supabase
      let context = '\n## DATOS DE O GRAN CAMIÑO 2025:\n\n';
      
      // Hotels para este equipo
      const { data: hotels } = await supabase
        .from('hotels')
        .select(`
          stage_id,
          hotel_name,
          city,
          address,
          stages(stage_number, date, start_location, finish_location, distance_km)
        `)
        .eq('team_id', teamId);
      
      if (hotels && hotels.length > 0) {
        context += '### HOTELES POR ETAPA:\n';
        hotels.forEach(h => {
          context += `- Etapa ${h.stages.stage_number}: ${h.hotel_name}, ${h.city}\n`;
        });
      }
      
      // Stages
      const { data: stages } = await supabase
        .from('stages')
        .select('*')
        .order('stage_number');
      
      if (stages && stages.length > 0) {
        context += '\n### ETAPAS:\n';
        stages.forEach(s => {
          context += `- Etapa ${s.stage_number} (${s.date}): ${s.start_location} → ${s.finish_location} (${s.distance_km}km)\n`;
        });
      }
      
      // Incidents
      const { data: incidents } = await supabase
        .from('incidents')
        .select('*, stages(stage_number, date)')
        .order('created_at', { ascending: false })
        .limit(10);
      
      if (incidents && incidents.length > 0) {
        context += '\n### INCIDENCIAS RECIENTES:\n';
        incidents.forEach(i => {
          context += `- Etapa ${i.stages.stage_number}: ${i.description}\n`;
        });
      }
      
      // Documents
      const { data: documents } = await supabase
        .from('documents')
        .select('*');
      
      if (documents && documents.length > 0) {
        context += '\n### DOCUMENTOS DISPONIBLES (Descargas):\n';
        documents.forEach(d => {
          const downloadUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/race-files${d.storage_path}`;
          context += `- 📄 ${d.name}: ${downloadUrl}\n`;
        });
      }
      
      const fullPrompt = SYSTEM_PROMPT + context;
      
      console.log('Sending to Claude:', {
        messageLength: message.length,
        contextLength: context.length,
        team: team
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