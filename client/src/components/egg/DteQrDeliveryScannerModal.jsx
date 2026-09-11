import { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import axios from 'axios';
import { toast } from 'sonner';
import Modal from '../ui/Modal';
import {
    Camera,
    QrCode,
    CheckCircle2,
    MapPin,
    Phone,
    User,
    Search,
    AlertCircle,
    Navigation,
    RefreshCw
} from 'lucide-react';


export default function DteQrDeliveryScannerModal({
    isOpen,
    onClose,
    stop,
    onDeliveryConfirmed
}) {
    const [scannerActive, setScannerActive] = useState(false);
    const [scannerError, setScannerError] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [searchingDte, setSearchingDte] = useState(false);
    const [dteSearchQuery, setDteSearchQuery] = useState('');
    const [matchingDtes, setMatchingDtes] = useState([]);

    // Formulario de confirmación
    const [dteCode, setDteCode] = useState('');
    const [receivedBy, setReceivedBy] = useState('');
    const [receiverPhone, setReceiverPhone] = useState('');
    const [deliveryNotes, setDeliveryNotes] = useState('');
    const [latitude, setLatitude] = useState(null);
    const [longitude, setLongitude] = useState(null);
    const [gpsAccuracy, setGpsAccuracy] = useState(null);
    const [isCapturingGps, setIsCapturingGps] = useState(false);
    const [updateBranchPermanent, setUpdateBranchPermanent] = useState(true);

    const html5QrCodeRef = useRef(null);

    // Inicializar datos cuando se abre la parada
    useEffect(() => {
        if (isOpen && stop) {
            setDteCode(stop.dte_codigo_generacion || '');
            setReceivedBy(stop.recibido_por || stop.branch_contact_person || '');
            setReceiverPhone(stop.telefono_receptor || stop.branch_contact_phone || stop.customer_phone || '');
            setDeliveryNotes(stop.observaciones_entrega || stop.branch_delivery_notes || '');
            setLatitude(stop.lat_entrega || stop.branch_latitude || null);
            setLongitude(stop.lng_entrega || stop.branch_longitude || null);
            setScannerActive(false);
            setScannerError(null);
            setMatchingDtes([]);
            setDteSearchQuery('');

            // Si aún no tiene GPS, intentar capturar automáticamente
            if (!stop.lat_entrega && !stop.branch_latitude) {
                handleCaptureGps(false);
            }
        }
    }, [isOpen, stop]);

    // Limpieza de cámara al cerrar
    useEffect(() => {
        return () => {
            stopScanner();
        };
    }, []);

    const startScanner = async () => {
        setScannerError(null);
        setScannerActive(true);

        try {
            // Esperar al siguiente frame para que el DOM esté listo
            await new Promise(r => setTimeout(r, 150));
            const qrRegion = document.getElementById('dte-qr-reader');
            if (!qrRegion) return;

            if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
                await html5QrCodeRef.current.stop();
            }

            const html5QrCode = new Html5Qrcode('dte-qr-reader');
            html5QrCodeRef.current = html5QrCode;

            await html5QrCode.start(
                { facingMode: 'environment' },
                {
                    fps: 10,
                    qrbox: { width: 250, height: 250 },
                    aspectRatio: 1.0
                },
                (decodedText) => {
                    handleQrScanned(decodedText);
                },
                () => {
                    // Scanning in progress
                }
            );
        } catch (err) {
            console.error('Error iniciando escáner QR:', err);
            setScannerError('No se pudo acceder a la cámara. Asegúrese de otorgar permisos o ingrese el código manualmente.');
            setScannerActive(false);
        }
    };

    const stopScanner = async () => {
        if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
            try {
                await html5QrCodeRef.current.stop();
            } catch (err) {
                console.error('Error deteniendo escáner:', err);
            }
        }
        setScannerActive(false);
    };

    // Procesar texto del QR escaneado (detecta URLs de Hacienda o UUIDs directos)
    const handleQrScanned = (text) => {
        if (!text) return;
        stopScanner();

        // Buscar UUID (código de generación DTE del Ministerio de Hacienda)
        const uuidRegex = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/i;
        const match = text.match(uuidRegex);

        if (match) {
            const detectedUuid = match[0].toUpperCase();
            setDteCode(detectedUuid);
            toast.success(`DTE detectado: ${detectedUuid}`);
        } else {
            setDteCode(text.trim());
            toast.info(`Código leído: ${text.trim()}`);
        }
    };

    // Capturar GPS usando la API del navegador del motorista
    const handleCaptureGps = (showToast = true) => {
        if (!navigator.geolocation) {
            if (showToast) toast.error('Su dispositivo no soporta geolocalización GPS.');
            return;
        }

        setIsCapturingGps(true);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                const acc = pos.coords.accuracy;

                setLatitude(lat);
                setLongitude(lng);
                setGpsAccuracy(Math.round(acc));
                setIsCapturingGps(false);

                if (showToast) {
                    toast.success(`Coordenadas fijadas con precisión de ±${Math.round(acc)}m.`);
                }
            },
            (err) => {
                console.error('Error obteniendo GPS:', err);
                setIsCapturingGps(false);
                if (showToast) {
                    toast.warning('No se pudo obtener la ubicación GPS exacta. Verifique los permisos de ubicación.');
                }
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    };

    // Buscar DTE manualmente
    const handleSearchDte = async (val) => {
        setDteSearchQuery(val);
        if (!val || val.length < 3) {
            setMatchingDtes([]);
            return;
        }

        setSearchingDte(true);
        try {
            const res = await axios.get('/api/egg-industrial/dispatch/search-dte-orders', {
                params: { query: val }
            });
            setMatchingDtes(res.data?.dtes || []);
        } catch (error) {
            console.error('Error buscando DTE:', error);
        } finally {
            setSearchingDte(false);
        }
    };

    const handleConfirmDelivery = async (e) => {
        e.preventDefault();
        if (!stop) return;

        if (!receivedBy || receivedBy.trim().length === 0) {
            toast.error('Debe ingresar el nombre de la persona que recibe en la sucursal.');
            return;
        }

        setIsSubmitting(true);
        try {
            const payload = {
                dte_codigo_generacion: dteCode || null,
                recibido_por: receivedBy.trim(),
                telefono_receptor: receiverPhone ? receiverPhone.trim() : null,
                observaciones_entrega: deliveryNotes ? deliveryNotes.trim() : null,
                latitude: latitude || null,
                longitude: longitude || null,
                update_branch_data: updateBranchPermanent
            };

            await axios.post(`/api/egg-industrial/dispatch/stops/${stop.id}/confirm`, payload);

            toast.success('¡Entrega confirmada y datos de sucursal actualizados exitosamente!');
            stopScanner();
            onClose();
            if (onDeliveryConfirmed) {
                onDeliveryConfirmed();
            }
        } catch (error) {
            console.error('Error confirmando entrega:', error);
            toast.error(error.response?.data?.message || 'Error al confirmar la entrega.');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!stop) return null;

    return (
        <Modal
            isOpen={isOpen}
            onClose={() => {
                stopScanner();
                onClose();
            }}
            title={`Confirmación de Entrega - Parada #${stop.orden_visita || 1}`}
            size="lg"
        >
            <form onSubmit={handleConfirmDelivery} className="space-y-4">
                {/* Resumen del Pedido y Cliente */}
                <div className="bg-gradient-to-br from-indigo-50/70 to-slate-50 p-4 rounded-2xl border border-indigo-100 shadow-sm">
                    <div className="flex items-start justify-between">
                        <div>
                            <span className="text-[10px] font-black uppercase tracking-wider text-indigo-600 bg-indigo-100/80 px-2 py-0.5 rounded-md">
                                {stop.product_type || 'Ovoproducto'}
                            </span>
                            <h4 className="text-base font-black text-slate-900 mt-1">
                                {stop.customer_name}
                            </h4>
                            <p className="text-xs text-slate-600 mt-0.5">
                                📍 <span className="font-semibold">{stop.branch_name || 'Sucursal Principal'}</span>
                                {stop.branch_address && ` - ${stop.branch_address}`}
                            </p>
                        </div>
                        <div className="text-right">
                            <span className="text-lg font-black text-indigo-700">
                                {stop.quantity_lbs || 0} Lbs
                            </span>
                            <p className="text-[11px] font-bold text-slate-500">
                                {Math.ceil((stop.quantity_lbs || 0) / 30)} Cubetas (30 Lb)
                            </p>
                        </div>
                    </div>
                </div>

                {/* 1. SECCIÓN: ESCÁNER QR DTE */}
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <QrCode className="w-5 h-5 text-indigo-600" />
                            <h5 className="text-xs font-black text-slate-800 uppercase tracking-wide">
                                Escanear QR de DTE (Hacienda)
                            </h5>
                        </div>
                        {!scannerActive ? (
                            <button
                                type="button"
                                onClick={startScanner}
                                className="flex items-center gap-1.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-xl shadow-sm transition"
                            >
                                <Camera className="w-3.5 h-3.5" />
                                <span>Abrir Cámara</span>
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={stopScanner}
                                className="text-xs font-bold bg-rose-50 text-rose-600 hover:bg-rose-100 px-3 py-1.5 rounded-xl border border-rose-200 transition"
                            >
                                Detener Cámara
                            </button>
                        )}
                    </div>

                    {/* Visor de Cámara */}
                    {scannerActive && (
                        <div className="rounded-xl overflow-hidden border-2 border-indigo-500 bg-black flex flex-col items-center p-2">
                            <div id="dte-qr-reader" className="w-full max-w-xs" />
                            <p className="text-[11px] text-white/80 mt-2 text-center">
                                Apunte la cámara hacia el código QR impreso en el DTE o ticket
                            </p>
                        </div>
                    )}

                    {scannerError && (
                        <div className="text-xs text-rose-600 bg-rose-50 p-2.5 rounded-xl border border-rose-100 flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                            <span>{scannerError}</span>
                        </div>
                    )}

                    {/* Input Código de Generación / DTE */}
                    <div>
                        <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                            Código de Generación DTE / Identificador
                        </label>
                        <div className="relative">
                            <input
                                type="text"
                                value={dteCode}
                                onChange={(e) => setDteCode(e.target.value.toUpperCase())}
                                placeholder="Ej: 5B4F1234-ABCD-4EF5-9876-1234567890AB"
                                className="w-full text-xs font-mono font-semibold bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none uppercase"
                            />
                            {dteCode && (
                                <span className="absolute right-3 top-2.5 text-emerald-600">
                                    <CheckCircle2 className="w-4 h-4" />
                                </span>
                            )}
                        </div>

                        {/* Búsqueda manual de DTE */}
                        <div className="mt-2">
                            <div className="relative">
                                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                                <input
                                    type="text"
                                    value={dteSearchQuery}
                                    onChange={(e) => handleSearchDte(e.target.value)}
                                    placeholder="O buscar por código o número de control en ventas emitidas..."
                                    className="w-full text-[11px] bg-slate-50/80 border border-slate-200 rounded-xl pl-8 pr-3 py-1.5 text-slate-700 outline-none focus:bg-white"
                                />
                                {searchingDte && (
                                    <RefreshCw className="w-3 h-3 absolute right-2.5 top-2.5 text-slate-400 animate-spin" />
                                )}
                            </div>

                            {matchingDtes.length > 0 && (
                                <div className="mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-36 overflow-y-auto divide-y divide-slate-100 z-10 relative">
                                    {matchingDtes.map((d) => (
                                        <button
                                            key={d.id}
                                            type="button"
                                            onClick={() => {
                                                setDteCode(d.codigo_generacion);
                                                setMatchingDtes([]);
                                                setDteSearchQuery('');
                                            }}
                                            className="w-full text-left p-2 hover:bg-indigo-50 transition text-xs flex justify-between items-center"
                                        >
                                            <div>
                                                <div className="font-mono font-bold text-indigo-700">{d.codigo_generacion}</div>
                                                <div className="text-[10px] text-slate-500">Control: {d.numero_control} | ${d.total}</div>
                                            </div>
                                            <span className="text-[10px] bg-indigo-100 text-indigo-700 font-bold px-1.5 py-0.5 rounded">
                                                Seleccionar
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* 2. SECCIÓN: DATOS DEL RECEPTOR & TELÉFONO */}
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                    <div className="flex items-center gap-2">
                        <User className="w-5 h-5 text-indigo-600" />
                        <h5 className="text-xs font-black text-slate-800 uppercase tracking-wide">
                            Receptor en Sucursal ("¿Por quién preguntar?")
                        </h5>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                                Nombre de quien recibe *
                            </label>
                            <input
                                type="text"
                                required
                                value={receivedBy}
                                onChange={(e) => setReceivedBy(e.target.value)}
                                placeholder="Ej: Don Carlos Ramos (Jefe de Panadería)"
                                className="w-full text-xs font-medium border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                            />
                        </div>

                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                                Número de teléfono del receptor *
                            </label>
                            <div className="relative">
                                <Phone className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                                <input
                                    type="text"
                                    value={receiverPhone}
                                    onChange={(e) => setReceiverPhone(e.target.value)}
                                    placeholder="Ej: 7890-1234 / 2250-0000"
                                    className="w-full text-xs font-medium border border-slate-200 rounded-xl pl-8 pr-3 py-2 text-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                                />
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                            Instrucciones o notas de acceso
                        </label>
                        <input
                            type="text"
                            value={deliveryNotes}
                            onChange={(e) => setDeliveryNotes(e.target.value)}
                            placeholder="Ej: Portón verde al fondo, descargar en área de refrigeración"
                            className="w-full text-xs font-medium border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                        />
                    </div>
                </div>

                {/* 3. SECCIÓN: GEOLOCALIZACIÓN GPS & ACTUALIZACIÓN DE SUCURSAL */}
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <MapPin className="w-5 h-5 text-emerald-600" />
                            <h5 className="text-xs font-black text-slate-800 uppercase tracking-wide">
                                Geolocalización GPS del Cliente
                            </h5>
                        </div>

                        <button
                            type="button"
                            onClick={() => handleCaptureGps(true)}
                            disabled={isCapturingGps}
                            className="flex items-center gap-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-xl shadow-sm transition disabled:opacity-50"
                        >
                            <Navigation className={`w-3.5 h-3.5 ${isCapturingGps ? 'animate-spin' : ''}`} />
                            <span>{isCapturingGps ? 'Obteniendo GPS...' : 'Fijar Mi Ubicación Actual'}</span>
                        </button>
                    </div>

                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex items-center justify-between text-xs">
                        <div>
                            <span className="font-bold text-slate-700">Coordenadas fijadas:</span>
                            {latitude && longitude ? (
                                <span className="font-mono text-emerald-700 ml-2 font-semibold">
                                    {latitude.toFixed(6)}, {longitude.toFixed(6)}
                                    {gpsAccuracy && ` (±${gpsAccuracy}m)`}
                                </span>
                            ) : (
                                <span className="text-amber-600 ml-2 font-medium">
                                    Sin coordenadas. Presione "Fijar Mi Ubicación Actual".
                                </span>
                            )}
                        </div>

                        {latitude && longitude && (
                            <a
                                href={`https://www.google.com/maps?q=${latitude},${longitude}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[11px] font-bold text-indigo-600 hover:underline flex items-center gap-1"
                            >
                                Ver en mapa ↗
                            </a>
                        )}
                    </div>

                    {/* Toggle para guardar permanentemente en la sucursal */}
                    <label className="flex items-start gap-2 pt-1 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={updateBranchPermanent}
                            onChange={(e) => setUpdateBranchPermanent(e.target.checked)}
                            className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4 border-slate-300"
                        />
                        <div className="text-xs text-slate-600 leading-tight">
                            <span className="font-bold text-slate-800">Actualizar esta sucursal permanentemente:</span> Guarda el contacto ("por quién preguntar"), teléfono y coordenadas GPS para que cualquier motorista futuro sepa cómo llegar con 1 clic.
                        </div>
                    </label>
                </div>

                {/* Acciones */}
                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                    <button
                        type="button"
                        onClick={() => {
                            stopScanner();
                            onClose();
                        }}
                        className="text-xs font-semibold text-slate-600 hover:text-slate-800 px-4 py-2 rounded-xl transition"
                    >
                        Cancelar
                    </button>
                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className="flex items-center gap-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl shadow-md transition disabled:opacity-50"
                    >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>{isSubmitting ? 'Guardando entrega...' : 'Confirmar Entrega y Actualizar Sucursal'}</span>
                    </button>
                </div>
            </form>
        </Modal>
    );
}
