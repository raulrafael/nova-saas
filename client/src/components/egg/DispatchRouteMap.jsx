import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Coordenadas predeterminadas de Planta Huevo Industrial / San Salvador
const DEFAULT_PLANT_COORDS = [13.6929, -89.2182];

/**
 * Crea un icono HTML personalizado para Leaflet con número de parada y color de prioridad
 */
const createCustomMarkerIcon = (number, status, priority, isPlant = false) => {
    if (isPlant) {
        return L.divIcon({
            className: 'custom-leaflet-marker',
            html: `
                <div style="
                    background: linear-gradient(135deg, #4f46e5, #3730a3);
                    color: white;
                    width: 38px;
                    height: 38px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-weight: 900;
                    font-size: 11px;
                    border: 3px solid white;
                    box-shadow: 0 4px 10px rgba(0,0,0,0.35);
                " title="Planta Huevo Industrial (Origen)">
                    🏭
                </div>
            `,
            iconSize: [38, 38],
            iconAnchor: [19, 19],
            popupAnchor: [0, -20]
        });
    }

    let bgColor = '#4f46e5'; // Indigo normal
    let borderColor = '#ffffff';

    if (status === 'entregado') {
        bgColor = '#10b981'; // Emerald entregado
    } else if (priority === 'urgente') {
        bgColor = '#ef4444'; // Red urgente
    } else if (priority === 'alta') {
        bgColor = '#f59e0b'; // Amber alta
    }

    return L.divIcon({
        className: 'custom-leaflet-marker',
        html: `
            <div style="
                background: ${bgColor};
                color: white;
                width: 32px;
                height: 32px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-weight: 800;
                font-size: 13px;
                border: 2.5px solid ${borderColor};
                box-shadow: 0 3px 8px rgba(0,0,0,0.3);
                position: relative;
            ">
                ${status === 'entregado' ? '✓' : number}
            </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -18]
    });
};

export default function DispatchRouteMap({ stops = [], activeStopId = null, onSelectStop = null, height = '450px' }) {
    const mapContainerRef = useRef(null);
    const mapInstanceRef = useRef(null);
    const markersLayerRef = useRef(null);
    const routePolylineRef = useRef(null);

    useEffect(() => {
        if (!mapContainerRef.current) return;

        // Inicializar mapa si no existe
        if (!mapInstanceRef.current) {
            const map = L.map(mapContainerRef.current, {
                center: DEFAULT_PLANT_COORDS,
                zoom: 12,
                zoomControl: true
            });

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap contributors',
                maxZoom: 19
            }).addTo(map);

            markersLayerRef.current = L.layerGroup().addTo(map);
            mapInstanceRef.current = map;
        }

        const map = mapInstanceRef.current;
        const markersGroup = markersLayerRef.current;
        markersGroup.clearLayers();

        if (routePolylineRef.current) {
            routePolylineRef.current.remove();
            routePolylineRef.current = null;
        }

        // 1. Marcador de Planta de Origen
        const plantMarker = L.marker(DEFAULT_PLANT_COORDS, {
            icon: createCustomMarkerIcon(0, 'plant', 'normal', true)
        }).addTo(markersGroup);

        plantMarker.bindPopup(`
            <div style="font-family: sans-serif; font-size: 12px; padding: 4px;">
                <div style="font-weight: bold; color: #1e1b4b; font-size: 13px;">🏭 Planta Huevo Industrial</div>
                <div style="color: #64748b; font-size: 11px;">Punto de Carga y Despacho</div>
            </div>
        `);

        const validCoords = [DEFAULT_PLANT_COORDS];
        const allBounds = [DEFAULT_PLANT_COORDS];

        // 2. Marcadores de paradas
        stops.forEach((stop, index) => {
            const lat = parseFloat(stop.branch_latitude || stop.lat_entrega);
            const lng = parseFloat(stop.branch_longitude || stop.lng_entrega);

            const hasCoords = !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0;

            if (hasCoords) {
                const coord = [lat, lng];
                validCoords.push(coord);
                allBounds.push(coord);

                const stopNumber = stop.orden_visita || (index + 1);
                const marker = L.marker(coord, {
                    icon: createCustomMarkerIcon(stopNumber, stop.estado_entrega, stop.prioridad)
                }).addTo(markersGroup);

                // Popup con diseño pulcro
                const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
                const wazeUrl = `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;

                const popupHtml = `
                    <div style="font-family: inherit; font-size: 12px; min-width: 220px; line-height: 1.4;">
                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px;">
                            <span style="font-weight: 800; font-size: 13px; color: #0f172a;">Parada #${stopNumber}</span>
                            <span style="
                                font-size: 10px;
                                font-weight: 800;
                                text-transform: uppercase;
                                padding: 2px 6px;
                                border-radius: 4px;
                                background: ${stop.estado_entrega === 'entregado' ? '#d1fae5; color: #065f46' : '#eff6ff; color: #1e40af'};
                            ">
                                ${stop.estado_entrega === 'entregado' ? 'Entregado' : (stop.prioridad || 'Normal')}
                            </span>
                        </div>
                        <div style="font-weight: 700; color: #1e293b; font-size: 13px;">${stop.customer_name || 'Cliente'}</div>
                        ${stop.branch_name ? `<div style="color: #64748b; font-size: 11px;">📍 ${stop.branch_name}</div>` : ''}
                        ${stop.branch_address ? `<div style="color: #475569; font-size: 11px; margin-top: 3px;">${stop.branch_address}</div>` : ''}
                        
                        <div style="margin-top: 6px; padding: 6px; background: #f8fafc; border-radius: 6px; border: 1px solid #f1f5f9;">
                            ${stop.branch_contact_person ? `<div style="font-size: 11px; color: #334155;"><strong>Preguntar por:</strong> ${stop.branch_contact_person}</div>` : ''}
                            ${stop.branch_contact_phone || stop.telefono_receptor ? `<div style="font-size: 11px; color: #334155;"><strong>Teléfono:</strong> ${stop.branch_contact_phone || stop.telefono_receptor}</div>` : ''}
                            <div style="font-size: 11px; color: #4338ca; font-weight: 700; margin-top: 2px;">
                                📦 ${stop.quantity_lbs || 0} Lbs (${Math.ceil((stop.quantity_lbs || 0) / 30)} cubetas)
                            </div>
                        </div>

                        <div style="display: flex; gap: 6px; margin-top: 8px;">
                            <a href="${gmapsUrl}" target="_blank" rel="noopener noreferrer" style="
                                flex: 1;
                                text-align: center;
                                background: #2563eb;
                                color: white;
                                padding: 4px 6px;
                                border-radius: 6px;
                                text-decoration: none;
                                font-weight: 700;
                                font-size: 10px;
                            ">
                                Google Maps
                            </a>
                            <a href="${wazeUrl}" target="_blank" rel="noopener noreferrer" style="
                                flex: 1;
                                text-align: center;
                                background: #0284c7;
                                color: white;
                                padding: 4px 6px;
                                border-radius: 6px;
                                text-decoration: none;
                                font-weight: 700;
                                font-size: 10px;
                            ">
                                Waze
                            </a>
                        </div>
                    </div>
                `;

                marker.bindPopup(popupHtml);

                if (onSelectStop) {
                    marker.on('click', () => onSelectStop(stop));
                }

                if (activeStopId && stop.id === activeStopId) {
                    setTimeout(() => marker.openPopup(), 200);
                }
            }
        });

        // 3. Trazar polilínea de la ruta
        if (validCoords.length > 1) {
            routePolylineRef.current = L.polyline(validCoords, {
                color: '#4f46e5',
                weight: 4,
                opacity: 0.8,
                dashArray: '6, 8',
                lineJoin: 'round'
            }).addTo(map);

            map.fitBounds(allBounds, { padding: [40, 40], maxZoom: 15 });
        } else {
            map.setView(DEFAULT_PLANT_COORDS, 12);
        }

        setTimeout(() => {
            map.invalidateSize();
        }, 200);

    }, [stops, activeStopId]);

    // Limpieza al desmontar componente
    useEffect(() => {
        return () => {
            if (mapInstanceRef.current) {
                mapInstanceRef.current.remove();
                mapInstanceRef.current = null;
            }
        };
    }, []);

    const stopsWithCoordsCount = stops.filter(s => {
        const lat = parseFloat(s.branch_latitude || s.lat_entrega);
        const lng = parseFloat(s.branch_longitude || s.lng_entrega);
        return !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0;
    }).length;

    return (
        <div className="relative w-full rounded-2xl overflow-hidden border border-slate-200 shadow-sm bg-slate-50">
            {/* Header / Info bar */}
            <div className="absolute top-3 left-3 z-[1000] bg-white/90 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-200 shadow-md flex items-center gap-2 text-xs font-semibold text-slate-700">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 animate-pulse" />
                <span>Ruta en Mapa: {stopsWithCoordsCount} de {stops.length} paradas geolocalizadas</span>
            </div>

            {/* Contenedor del Mapa Leaflet */}
            <div ref={mapContainerRef} style={{ height, width: '100%', minHeight: '350px' }} />

            {stopsWithCoordsCount === 0 && (
                <div className="absolute inset-0 z-[500] pointer-events-none flex items-center justify-center bg-slate-900/10 backdrop-blur-[1px]">
                    <div className="bg-white px-4 py-2.5 rounded-xl shadow-lg border border-slate-200 text-xs text-slate-600 font-medium">
                        💡 Las sucursales aún no tienen coordenadas GPS. Al confirmar cada entrega desde el teléfono del motorista, se guardarán automáticamente en el mapa.
                    </div>
                </div>
            )}
        </div>
    );
}
