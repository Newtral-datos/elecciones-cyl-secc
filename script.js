document.addEventListener("DOMContentLoaded", function() {
  let protocol = new pmtiles.Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);

  const map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      sources: {
        'carto-light': {
          type: 'raster',
          tiles: [
            'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
            'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
            'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'
          ],
          tileSize: 256,
          attribution: '© OpenStreetMap contributors, © CARTO'
        }
      },
      layers: [{ id: 'carto-light', type: 'raster', source: 'carto-light', minzoom: 0, maxzoom: 22 }]
    },
    center: [-4.43, 41.66],
    zoom: 7,
    minZoom: 6
  });

  map.addControl(new maplibregl.NavigationControl(), 'top-right');

  const LAYER_ID     = 'secciones_fill';
  const LAYER_LINE   = 'secciones_line';
  const SOURCE_LAYER = 'secciones_electorales';

  const PARTY_COLORS = {
    'PP':      '#1e4a90',
    'PSOE':    '#f31912',
    'VOX':     '#66bc29',
    'U.P.L.':  '#b81967',
    'XAV':     '#f7d70e',
    'SY':      '#000000',
    'VBM':     '#B85542',
    'PODEMOS': '#9169f4',
  };
  const COLOR_DEFAULT = '#d8d8d8';

  // Normaliza nombres de partido para el lookup de colores y 2022
  // (2022 usa 'P.S.O.E.', 'UPL', etc.)
  const ALIAS = {
    'P.S.O.E.': 'PSOE',
    'UPL':      'U.P.L.',
  };
  function normalizar(nombre) {
    return ALIAS[nombre] || nombre;
  }
  function colorPartido(nombre) {
    return PARTY_COLORS[normalizar(nombre)] || COLOR_DEFAULT;
  }

  const deselected = new Set();

  function colorExpression() {
    const expr = ['match', ['get', 'cand_1']];
    Object.entries(PARTY_COLORS).forEach(([p, c]) => expr.push(p, deselected.has(p) ? COLOR_DEFAULT : c));
    expr.push(COLOR_DEFAULT);
    return expr;
  }

  function fmt(n, dec = 1) {
    if (n == null || n === '') return '—';
    return Number(n).toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  map.on('load', function() {
    map.addSource('secciones', {
      type: 'vector',
      url: 'pmtiles://secciones_electorales.pmtiles'
    });

    map.addLayer({
      id: LAYER_ID,
      type: 'fill',
      source: 'secciones',
      'source-layer': SOURCE_LAYER,
      paint: { 'fill-color': colorExpression(), 'fill-opacity': 0.75 }
    });

    map.addLayer({
      id: LAYER_LINE,
      type: 'line',
      source: 'secciones',
      'source-layer': SOURCE_LAYER,
      paint: {
        'line-color': 'rgba(0,0,0,0.18)',
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.3, 13, 1]
      }
    });

    // ── Popup ──
    const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '320px' });

    map.on('click', LAYER_ID, function(e) {
      const p     = e.features[0].properties;
      const cusec = p.CUSEC;
      const dist  = cusec.substring(5, 7);
      const sec   = cusec.substring(7, 10);

      const part = p.total_votantes > 0 ? fmt(p.total_votantes / p.censo_total * 100) : '—';

      const top3 = [
        { n: p.cand_1, v: p.votos_1, p: p.pct_1 },
        { n: p.cand_2, v: p.votos_2, p: p.pct_2 },
        { n: p.cand_3, v: p.votos_3, p: p.pct_3 },
        { n: p.cand_4, v: p.votos_4, p: p.pct_4 },
        { n: p.cand_5, v: p.votos_5, p: p.pct_5 },
      ].filter(x => x.n);

      const filas = top3.map(x => {
        const color = colorPartido(x.n);
        return `
          <tr>
            <td class="td-partido">
              <span class="dot" style="background:${color}"></span>${x.n}
            </td>
            <td class="td-num td-bold">${Number(x.v).toLocaleString('es-ES')}</td>
            <td class="td-num td-pct">${fmt(x.p)}%</td>
          </tr>`;
      }).join('');

      popup.setLngLat(e.lngLat).setHTML(`
        <div class="popup-title">${p.nombre_municipio}</div>
        <div class="popup-subtitle">${p.provincia} &nbsp;·&nbsp; ${dist}-${sec}</div>
        <table class="popup-table">
          <tbody>${filas}</tbody>
        </table>
        <div class="popup-meta">Censo ${Number(p.censo_total).toLocaleString('es-ES')} &nbsp;·&nbsp; Participación ${part}%</div>
      `).addTo(map);
    });

    map.on('mouseenter', LAYER_ID, () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', LAYER_ID, () => map.getCanvas().style.cursor = '');

    // ── Leyenda ──
    const legendEl = document.getElementById('legend-items');
    Object.entries(PARTY_COLORS).forEach(([partido, color]) => {
      const btn = document.createElement('button');
      btn.className = 'legend-item';
      btn.textContent = partido;
      btn.style.background = color;
      btn.addEventListener('click', () => {
        if (deselected.has(partido)) {
          deselected.delete(partido);
          btn.classList.remove('off');
        } else {
          deselected.add(partido);
          btn.classList.add('off');
        }
        map.setPaintProperty(LAYER_ID, 'fill-color', colorExpression());
      });
      legendEl.appendChild(btn);
    });

    // ── Geocoder ──
    const geocoderApi = {
      forwardGeocode: async (config) => {
        const features = [];
        try {
          const req = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(config.query)}&format=geojson&addressdetails=1&countrycodes=es&limit=5`;
          const geojson = await (await fetch(req)).json();
          for (const feat of geojson.features) {
            const center = feat.bbox
              ? [feat.bbox[0] + (feat.bbox[2] - feat.bbox[0]) / 2, feat.bbox[1] + (feat.bbox[3] - feat.bbox[1]) / 2]
              : feat.geometry.coordinates;
            features.push({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: center },
              place_name: feat.properties.display_name,
              properties: feat.properties,
              text: feat.properties.display_name,
              place_type: ['place'],
              center
            });
          }
        } catch (err) { console.error('Geocoding error:', err); }
        return { features };
      }
    };

    const geocoder = new MaplibreGeocoder(geocoderApi, {
      maplibregl,
      placeholder: 'Buscar ubicación...',
      showResultMarker: false,
      marker: false,
      flyTo: { zoom: 12, speed: 1.2 },
      minLength: 3,
      debounceSearch: 300,
      showResultsWhileTyping: true
    });

    document.getElementById('geocoder-container').appendChild(geocoder.onAdd(map));
  });
});
