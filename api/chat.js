import xml2js from 'xml2js';

// Leer GPX
async function downloadAndReadGPX(fileId) {
  if (!drive) return null;
  
  try {
    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    
    const gpxText = Buffer.from(response.data).toString('utf-8');
    const parser = new xml2js.Parser();
    const gpxData = await parser.parseStringPromise(gpxText);
    
    // Extraer información útil
    const result = {
      metadata: gpxData.gpx?.metadata?.[0] || {},
      trackpoints: [],
      waypoints: [],
      totalDistance: 0,
      elevation: { min: null, max: null }
    };
    
    // Track points
    if (gpxData.gpx?.trk) {
      gpxData.gpx.trk.forEach(track => {
        if (track.trkseg) {
          track.trkseg.forEach(segment => {
            if (segment.trkpt) {
              segment.trkpt.forEach(point => {
                result.trackpoints.push({
                  lat: point.$.lat,
                  lon: point.$.lon,
                  ele: point.ele?.[0],
                  time: point.time?.[0]
                });
              });
            }
          });
        }
      });
    }
    
    // Way points
    if (gpxData.gpx?.wpt) {
      gpxData.gpx.wpt.forEach(point => {
        result.waypoints.push({
          name: point.name?.[0],
          lat: point.$.lat,
          lon: point.$.lon,
          ele: point.ele?.[0]
        });
      });
    }
    
    return result;
  } catch (error) {
    console.error(`Error reading GPX ${fileId}:`, error.message);
    return null;
  }
}

// Procesar archivo (ACTUALIZADO)
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
    
    // GPX
    if (file.name.endsWith('.gpx') || file.mimeType.includes('gpx')) {
      console.log(`Reading GPX: ${file.name}`);
      return await downloadAndReadGPX(file.id);
    }
    
    return null;
  } catch (error) {
    console.error(`Error processing ${file.name}:`, error.message);
    return null;
  }
}