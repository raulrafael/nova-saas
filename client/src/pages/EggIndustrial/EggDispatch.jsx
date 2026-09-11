import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'sonner';
import Modal from '../../components/ui/Modal';
import Money, { MoneyInput } from '../../components/ui/Money';
import DispatchRouteMap from '../../components/egg/DispatchRouteMap';
import DteQrDeliveryScannerModal from '../../components/egg/DteQrDeliveryScannerModal';
import {
    Truck,
    Calendar as CalendarIcon,
    Navigation,
    Phone,
    CheckCircle2,
    AlertTriangle,
    Plus,
    RefreshCw,
    Wrench,
    ArrowUp,
    ArrowDown,
    Trash2,
    Edit3,
    QrCode,
    Sparkles,
    ExternalLink
} from 'lucide-react';

const PRODUCT_PROFILES = [
    'Huevo Entero Pasteurizado',
    'Huevo Formulado por Separación',
    'Huevo Entero Plus',
    'Clara de Huevo Pasteurizada',
    'Yema Azucarada',
    'Yema Salada',
    'Huevo con Leche'
];

const PRESENTATIONS = [
    'cubeta 30LB',
    'cubeta 32LB',
    'galon 8LB',
    'medio galon 4LB',
    'litro 2LB',
    'bolsa 20LB'
];

export default function EggDispatch() {
    const [searchParams, setSearchParams] = useSearchParams();

    // Pestaña activa: 'calendario' | 'rutas' | 'flota' | 'motorista'
    const initialTab = searchParams.get('tab') || 'calendario';
    const [activeTab, setActiveTab] = useState(initialTab);

    // Estados generales
    const [loading, setLoading] = useState(false);
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);



    // =========================================================================
    // 1. ESTADO: PEDIDOS Y CALENDARIO
    // =========================================================================
    const [orders, setOrders] = useState([]);
    const [orderModalOpen, setOrderModalOpen] = useState(false);
    const [editingOrder, setEditingOrder] = useState(null);
    const [orderStatusFilter, setOrderStatusFilter] = useState('todos');
    const [orderPriorityFilter, setOrderPriorityFilter] = useState('todos');

    // Formulario de Pedido
    const [orderForm, setOrderForm] = useState({
        customer_id: '',
        customer_branch_id: '',
        customer_name: '',
        order_number: '',
        product_type: 'Huevo Entero Pasteurizado',
        presentation: 'cubeta 30LB',
        quantity_lbs: '',
        required_delivery_date: new Date().toISOString().split('T')[0],
        priority: 'normal',
        price_per_lb: '',
        notes: ''
    });

    const [customerSearch, setCustomerSearch] = useState('');
    const [customerOptions, setCustomerOptions] = useState([]);
    const [searchingCustomer, setSearchingCustomer] = useState(false);
    const [customerBranches, setCustomerBranches] = useState([]);

    // =========================================================================
    // 2. ESTADO: RUTAS Y PLANIFICADOR
    // =========================================================================
    const [routes, setRoutes] = useState([]);
    const [selectedRoute, setSelectedRoute] = useState(null);
    const [routeDetail, setRouteDetail] = useState(null);
    const [routeModalOpen, setRouteModalOpen] = useState(false);
    const [editingRouteId, setEditingRouteId] = useState(null);
    const [optimizingRoute, setOptimizingRoute] = useState(false);

    // Formulario de Ruta
    const [routeForm, setRouteForm] = useState({
        codigo_ruta: '',
        fecha_despacho: new Date().toISOString().split('T')[0],
        vehicle_id: '',
        driver_id: '',
        driver_name: '',
        driver_phone: '',
        hora_salida_estimada: '07:00:00',
        notas_ruta: '',
        selectedOrderIds: []
    });

    // =========================================================================
    // 3. ESTADO: FLOTA Y MANTENIMIENTO
    // =========================================================================
    const [vehicles, setVehicles] = useState([]);
    const [vehicleModalOpen, setVehicleModalOpen] = useState(false);
    const [editingVehicle, setEditingVehicle] = useState(null);
    const [vehicleForm, setVehicleForm] = useState({
        codigo: '',
        placa: '',
        marca: '',
        modelo: '',
        anio: new Date().getFullYear(),
        tipo_vehiculo: 'camion_refrigerado',
        capacidad_peso_lbs: 10000,
        capacidad_cubetas: 350,
        tiene_termo_king: true,
        odometro_actual: 0,
        estado: 'disponible',
        notas: ''
    });

    const [maintenanceLogs, setMaintenanceLogs] = useState([]);
    const [maintenanceModalOpen, setMaintenanceModalOpen] = useState(false);
    const [maintenanceForm, setMaintenanceForm] = useState({
        vehicle_id: '',
        tipo_mantenimiento: 'preventivo',
        fecha_programada: new Date().toISOString().split('T')[0],
        fecha_realizada: '',
        odometro: '',
        taller_proveedor: '',
        costo_total: 0,
        descripcion: '',
        repuestos_cambiados: '',
        estado: 'programado',
        proximo_servicio_km: '',
        proximo_servicio_fecha: '',
        notas: ''
    });

    // =========================================================================
    // 4. ESTADO: MODO MOTORISTA Y ESCÁNER QR
    // =========================================================================
    const [driverRoutes, setDriverRoutes] = useState([]);
    const [activeDriverRouteId, setActiveDriverRouteId] = useState(null);
    const [deliveryScannerModalOpen, setDeliveryScannerModalOpen] = useState(false);
    const [selectedStopToDeliver, setSelectedStopToDeliver] = useState(null);

    // Catálogos generales
    const [factoryUsers, setFactoryUsers] = useState([]);

    // Sincronizar parámetro URL
    useEffect(() => {
        setSearchParams({ tab: activeTab });
    }, [activeTab]);

    // Carga inicial
    useEffect(() => {
        fetchVehicles();
        fetchOrders();
        fetchRoutes();
        fetchFactoryUsers();
    }, []);

    // Cargar cuando cambia la pestaña o fecha
    useEffect(() => {
        if (activeTab === 'calendario') {
            fetchOrders();
        } else if (activeTab === 'rutas') {
            fetchRoutes();
            fetchVehicles();
        } else if (activeTab === 'flota') {
            fetchVehicles();
            fetchMaintenanceLogs();
        } else if (activeTab === 'motorista') {
            fetchDriverRoutes();
        }
    }, [activeTab, selectedDate]);

    // Cargar detalle de ruta si hay una seleccionada
    useEffect(() => {
        if (selectedRoute?.id) {
            fetchRouteDetail(selectedRoute.id);
        }
    }, [selectedRoute]);

    // =========================================================================
    // API CALLS: PEDIDOS
    // =========================================================================
    const fetchOrders = async () => {
        setLoading(true);
        try {
            const res = await axios.get('/api/egg-industrial/orders');
            setOrders(res.data || []);
        } catch (error) {
            console.error('Error al cargar pedidos:', error);
            toast.error('Error al cargar pedidos de clientes.');
        } finally {
            setLoading(false);
        }
    };

    const handleCustomerSearch = async (query) => {
        setCustomerSearch(query);
        if (!query || query.length < 2) {
            setCustomerOptions([]);
            return;
        }
        setSearchingCustomer(true);
        try {
            const res = await axios.get('/api/customers', { params: { search: query, limit: 10 } });
            setCustomerOptions(res.data?.data || res.data || []);
        } catch (error) {
            console.error('Error buscando clientes:', error);
        } finally {
            setSearchingCustomer(false);
        }
    };

    const handleSelectCustomer = async (cust) => {
        setOrderForm(prev => ({
            ...prev,
            customer_id: cust.id,
            customer_name: cust.nombre,
            customer_branch_id: ''
        }));
        setCustomerSearch(cust.nombre);
        setCustomerOptions([]);

        // Cargar sucursales de este cliente
        try {
            const res = await axios.get('/api/egg-industrial/dispatch/customer-branches', {
                params: { customer_id: cust.id }
            });
            const branches = res.data || [];
            setCustomerBranches(branches);
            if (branches.length > 0) {
                setOrderForm(prev => ({ ...prev, customer_branch_id: branches[0].id }));
            }
        } catch (error) {
            console.error('Error cargando sucursales:', error);
        }
    };

    const handleSaveOrder = async (e) => {
        e.preventDefault();
        try {
            const payload = { ...orderForm };
            if (editingOrder?.id) {
                await axios.put(`/api/egg-industrial/orders/${editingOrder.id}`, payload);
                toast.success('Pedido actualizado exitosamente.');
            } else {
                await axios.post('/api/egg-industrial/orders', payload);
                toast.success('Pedido creado exitosamente.');
            }
            setOrderModalOpen(false);
            setEditingOrder(null);
            fetchOrders();
        } catch (error) {
            console.error('Error al guardar pedido:', error);
            toast.error(error.response?.data?.message || 'Error al guardar pedido.');
        }
    };

    const handleDeleteOrder = async (id) => {
        if (!window.confirm('¿Eliminar este pedido de cliente?')) return;
        try {
            await axios.delete(`/api/egg-industrial/orders/${id}`);
            toast.success('Pedido eliminado.');
            fetchOrders();
        } catch (error) {
            console.error('Error al eliminar pedido:', error);
            toast.error('Error al eliminar pedido.');
        }
    };

    // =========================================================================
    // API CALLS: RUTAS
    // =========================================================================
    const fetchRoutes = async () => {
        try {
            const res = await axios.get('/api/egg-industrial/dispatch/routes', {
                params: { fecha_desde: selectedDate ? `${selectedDate.substring(0, 7)}-01` : undefined }
            });
            const list = res.data || [];
            setRoutes(list);
            if (list.length > 0 && !selectedRoute) {
                setSelectedRoute(list[0]);
            }
        } catch (error) {
            console.error('Error cargando rutas:', error);
        }
    };

    const fetchRouteDetail = async (routeId) => {
        try {
            const res = await axios.get(`/api/egg-industrial/dispatch/routes/${routeId}`);
            setRouteDetail(res.data || null);
        } catch (error) {
            console.error('Error al cargar detalle de ruta:', error);
        }
    };

    const handleOpenCreateRoute = (preselectedDate = null, preselectedOrderIds = []) => {
        const targetDate = preselectedDate || selectedDate || new Date().toISOString().split('T')[0];
        setRouteForm({
            codigo_ruta: '',
            fecha_despacho: targetDate,
            vehicle_id: '',
            driver_id: '',
            driver_name: '',
            driver_phone: '',
            hora_salida_estimada: '07:00:00',
            notas_ruta: '',
            selectedOrderIds: preselectedOrderIds
        });
        setEditingRouteId(null);
        setRouteModalOpen(true);
    };

    const handleSaveRoute = async (e) => {
        e.preventDefault();

        if (!routeForm.vehicle_id) {
            toast.error('Debe seleccionar un camión para la ruta.');
            return;
        }

        if (routeForm.selectedOrderIds.length === 0) {
            toast.error('Debe seleccionar al menos un pedido para armar la ruta.');
            return;
        }

        // Construir paradas a partir de los pedidos seleccionados
        const stopsPayload = routeForm.selectedOrderIds.map((orderId, idx) => {
            const ord = orders.find(o => o.id === orderId);
            return {
                order_id: orderId,
                customer_id: ord?.customer_id,
                customer_branch_id: ord?.customer_branch_id,
                prioridad: ord?.priority || 'normal',
                orden_visita: idx + 1
            };
        });

        try {
            const payload = {
                ...routeForm,
                stops: stopsPayload
            };

            if (editingRouteId) {
                await axios.put(`/api/egg-industrial/dispatch/routes/${editingRouteId}`, payload);
                toast.success('Ruta actualizada exitosamente.');
            } else {
                const res = await axios.post('/api/egg-industrial/dispatch/routes', payload);
                toast.success(res.data?.message || 'Ruta de despacho creada exitosamente.');
            }
            setRouteModalOpen(false);
            fetchRoutes();
            fetchOrders();
            if (editingRouteId) fetchRouteDetail(editingRouteId);
        } catch (error) {
            console.error('Error al guardar ruta:', error);
            toast.error(error.response?.data?.message || 'Error al guardar ruta de despacho.');
        }
    };

    const handleDeleteRoute = async (routeId) => {
        if (!window.confirm('¿Eliminar esta ruta de despacho? Los pedidos volverán a quedar disponibles.')) return;
        try {
            await axios.delete(`/api/egg-industrial/dispatch/routes/${routeId}`);
            toast.success('Ruta eliminada y pedidos liberados.');
            setSelectedRoute(null);
            setRouteDetail(null);
            fetchRoutes();
            fetchOrders();
        } catch (error) {
            console.error('Error al eliminar ruta:', error);
            toast.error('Error al eliminar ruta.');
        }
    };

    const handleOptimizeRoute = async () => {
        if (!routeDetail?.id) return;
        setOptimizingRoute(true);
        try {
            await axios.post(`/api/egg-industrial/dispatch/routes/${routeDetail.id}/optimize`);
            toast.success('¡Ruta optimizada con éxito según prioridad y cercanía geográfica!');
            fetchRouteDetail(routeDetail.id);
        } catch (error) {
            console.error('Error optimizando ruta:', error);
            toast.error('Error al optimizar la ruta.');
        } finally {
            setOptimizingRoute(false);
        }
    };

    const handleMoveStop = async (stopIndex, direction) => {
        if (!routeDetail?.stops) return;
        const currentStops = [...routeDetail.stops];
        const targetIndex = stopIndex + direction;

        if (targetIndex < 0 || targetIndex >= currentStops.length) return;

        // Intercambiar
        const temp = currentStops[stopIndex];
        currentStops[stopIndex] = currentStops[targetIndex];
        currentStops[targetIndex] = temp;

        const stopsToUpdate = currentStops.map((s, idx) => ({
            id: s.id,
            orden_visita: idx + 1
        }));

        try {
            await axios.put(`/api/egg-industrial/dispatch/routes/${routeDetail.id}/reorder`, {
                stops: stopsToUpdate
            });
            fetchRouteDetail(routeDetail.id);
        } catch (error) {
            console.error('Error al reordenar paradas:', error);
            toast.error('Error al reordenar paradas.');
        }
    };

    // =========================================================================
    // API CALLS: FLOTA Y MANTENIMIENTO
    // =========================================================================
    const fetchVehicles = async () => {
        try {
            const res = await axios.get('/api/egg-industrial/dispatch/vehicles');
            setVehicles(res.data || []);
        } catch (error) {
            console.error('Error cargando vehículos:', error);
        }
    };

    const fetchMaintenanceLogs = async () => {
        try {
            const res = await axios.get('/api/egg-industrial/dispatch/maintenance');
            setMaintenanceLogs(res.data || []);
        } catch (error) {
            console.error('Error cargando mantenimientos:', error);
        }
    };

    const handleSaveVehicle = async (e) => {
        e.preventDefault();
        try {
            if (editingVehicle?.id) {
                await axios.put(`/api/egg-industrial/dispatch/vehicles/${editingVehicle.id}`, vehicleForm);
                toast.success('Vehículo actualizado.');
            } else {
                await axios.post('/api/egg-industrial/dispatch/vehicles', vehicleForm);
                toast.success('Vehículo agregado a la flota.');
            }
            setVehicleModalOpen(false);
            setEditingVehicle(null);
            fetchVehicles();
        } catch (error) {
            console.error('Error al guardar vehículo:', error);
            toast.error(error.response?.data?.message || 'Error al guardar vehículo.');
        }
    };

    const handleSaveMaintenance = async (e) => {
        e.preventDefault();
        try {
            await axios.post('/api/egg-industrial/dispatch/maintenance', maintenanceForm);
            toast.success('Mantenimiento registrado exitosamente.');
            setMaintenanceModalOpen(false);
            fetchMaintenanceLogs();
            fetchVehicles();
        } catch (error) {
            console.error('Error al registrar mantenimiento:', error);
            toast.error(error.response?.data?.message || 'Error al guardar mantenimiento.');
        }
    };

    // =========================================================================
    // API CALLS: MODO MOTORISTA
    // =========================================================================
    const fetchDriverRoutes = async () => {
        try {
            const res = await axios.get('/api/egg-industrial/dispatch/my-routes', {
                params: { fecha: selectedDate }
            });
            const dRoutes = res.data || [];
            setDriverRoutes(dRoutes);
            if (dRoutes.length > 0 && !activeDriverRouteId) {
                setActiveDriverRouteId(dRoutes[0].id);
                fetchRouteDetail(dRoutes[0].id);
            }
        } catch (error) {
            console.error('Error cargando rutas del motorista:', error);
        }
    };

    const fetchFactoryUsers = async () => {
        try {
            const res = await axios.get('/api/egg-industrial/factory-users');
            setFactoryUsers(res.data || []);
        } catch (error) {
            console.error('Error cargando usuarios:', error);
        }
    };

    // =========================================================================
    // FILTROS Y DATOS CALCULADOS
    // =========================================================================
    const filteredOrders = useMemo(() => {
        return orders.filter(o => {
            const matchesStatus = orderStatusFilter === 'todos' || o.delivery_status === orderStatusFilter;
            const matchesPriority = orderPriorityFilter === 'todos' || o.priority === orderPriorityFilter;
            return matchesStatus && matchesPriority;
        });
    }, [orders, orderStatusFilter, orderPriorityFilter]);

    // Pedidos pendientes agrupados por fecha
    const ordersByDate = useMemo(() => {
        const map = {};
        orders.forEach(o => {
            const d = o.required_delivery_date ? o.required_delivery_date.split('T')[0] : 'Sin fecha';
            if (!map[d]) map[d] = [];
            map[d].push(o);
        });
        return map;
    }, [orders]);

    // Capacidad en tiempo real del vehículo seleccionado en la ruta
    const selectedVehicleForRoute = useMemo(() => {
        return vehicles.find(v => v.id === parseInt(routeForm.vehicle_id));
    }, [vehicles, routeForm.vehicle_id]);

    const calculatedLoadForNewRoute = useMemo(() => {
        let lbs = 0;
        routeForm.selectedOrderIds.forEach(id => {
            const ord = orders.find(o => o.id === id);
            if (ord) lbs += parseFloat(ord.quantity_lbs) || 0;
        });
        const cubetas = Math.ceil(lbs / 30.0);
        const maxLbs = parseFloat(selectedVehicleForRoute?.capacidad_peso_lbs) || 10000;
        const maxCubetas = parseInt(selectedVehicleForRoute?.capacidad_cubetas) || 350;
        const pctLbs = maxLbs > 0 ? (lbs / maxLbs) * 100 : 0;
        const pctCubetas = maxCubetas > 0 ? (cubetas / maxCubetas) * 100 : 0;

        return {
            totalLbs: lbs,
            totalCubetas: cubetas,
            maxLbs,
            maxCubetas,
            pctLbs: Math.min(pctLbs, 100),
            pctCubetas: Math.min(pctCubetas, 100),
            isOverload: lbs > maxLbs || cubetas > maxCubetas
        };
    }, [routeForm.selectedOrderIds, orders, selectedVehicleForRoute]);

    return (
        <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
            {/* Header Principal */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-5 md:p-6 rounded-3xl text-white shadow-xl">
                <div>
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-indigo-500/20 backdrop-blur-md rounded-2xl border border-indigo-400/30 text-indigo-300">
                            <Truck className="w-6 h-6" />
                        </div>
                        <div>
                            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400">
                                Huevo Industrial - Logística de Entregas
                            </span>
                            <h1 className="text-xl md:text-2xl font-black tracking-tight">
                                Espacio de Despachos y Rutas
                            </h1>
                        </div>
                    </div>
                    <p className="text-xs text-slate-300 mt-2 max-w-2xl">
                        Planificación de rutas inteligentes según capacidad de camiones, control e historial de mantenimiento de flota, y asignación a motoristas con escaneo QR de DTE y georreferenciación de clientes.
                    </p>
                </div>

                {/* Acciones Rápidas de Cabecera */}
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        onClick={() => {
                            setOrderForm({
                                customer_id: '',
                                customer_branch_id: '',
                                customer_name: '',
                                order_number: '',
                                product_type: 'Huevo Entero Pasteurizado',
                                presentation: 'cubeta 30LB',
                                quantity_lbs: '',
                                required_delivery_date: selectedDate,
                                priority: 'normal',
                                price_per_lb: '',
                                notes: ''
                            });
                            setCustomerSearch('');
                            setEditingOrder(null);
                            setOrderModalOpen(true);
                        }}
                        className="flex items-center gap-1.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white px-3.5 py-2 rounded-xl shadow-lg transition"
                    >
                        <Plus className="w-4 h-4" />
                        <span>Nuevo Pedido</span>
                    </button>

                    <button
                        onClick={() => handleOpenCreateRoute()}
                        className="flex items-center gap-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-2 rounded-xl shadow-lg transition"
                    >
                        <Navigation className="w-4 h-4" />
                        <span>Planificar Ruta</span>
                    </button>
                </div>
            </div>

            {/* Selector de Pestañas */}
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2">
                <button
                    onClick={() => setActiveTab('calendario')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs transition ${
                        activeTab === 'calendario'
                            ? 'bg-indigo-600 text-white shadow-md'
                            : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                    }`}
                >
                    <CalendarIcon className="w-4 h-4" />
                    <span>1. Calendario de Pedidos</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${activeTab === 'calendario' ? 'bg-indigo-800 text-white' : 'bg-slate-100 text-slate-700'}`}>
                        {orders.length}
                    </span>
                </button>

                <button
                    onClick={() => setActiveTab('rutas')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs transition ${
                        activeTab === 'rutas'
                            ? 'bg-indigo-600 text-white shadow-md'
                            : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                    }`}
                >
                    <Navigation className="w-4 h-4" />
                    <span>2. Planificador de Rutas & Mapa</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${activeTab === 'rutas' ? 'bg-indigo-800 text-white' : 'bg-slate-100 text-slate-700'}`}>
                        {routes.length}
                    </span>
                </button>

                <button
                    onClick={() => setActiveTab('flota')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs transition ${
                        activeTab === 'flota'
                            ? 'bg-indigo-600 text-white shadow-md'
                            : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                    }`}
                >
                    <Wrench className="w-4 h-4" />
                    <span>3. Flota y Mantenimiento</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${activeTab === 'flota' ? 'bg-indigo-800 text-white' : 'bg-slate-100 text-slate-700'}`}>
                        {vehicles.length}
                    </span>
                </button>

                <button
                    onClick={() => setActiveTab('motorista')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs transition ${
                        activeTab === 'motorista'
                            ? 'bg-emerald-600 text-white shadow-md'
                            : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                    }`}
                >
                    <Phone className="w-4 h-4" />
                    <span>4. Modo Motorista (Móvil)</span>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.2 rounded-full">
                        Entregas Hoy
                    </span>
                </button>
            </div>

            {/* ========================================================================= */}
            {/* PESTAÑA 1: CALENDARIO DE PEDIDOS */}
            {/* ========================================================================= */}
            {activeTab === 'calendario' && (
                <div className="space-y-4">
                    {/* Barra de Filtros y Fechas */}
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                        <div className="flex flex-wrap items-center gap-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">
                                Fecha de Entrega:
                            </label>
                            <input
                                type="date"
                                value={selectedDate}
                                onChange={(e) => setSelectedDate(e.target.value)}
                                className="text-xs font-bold bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-slate-700 outline-none"
                            />
                            <button
                                onClick={() => setSelectedDate(new Date().toISOString().split('T')[0])}
                                className="text-xs font-semibold text-indigo-600 hover:underline px-1"
                            >
                                Hoy
                            </button>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            {/* Filtro Estado */}
                            <select
                                value={orderStatusFilter}
                                onChange={(e) => setOrderStatusFilter(e.target.value)}
                                className="text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-slate-700 outline-none"
                            >
                                <option value="todos">Todos los estados</option>
                                <option value="pendiente">Pendientes</option>
                                <option value="en_ruta">En Ruta</option>
                                <option value="entregado">Entregados</option>
                            </select>

                            {/* Filtro Prioridad */}
                            <select
                                value={orderPriorityFilter}
                                onChange={(e) => setOrderPriorityFilter(e.target.value)}
                                className="text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-slate-700 outline-none"
                            >
                                <option value="todos">Todas las prioridades</option>
                                <option value="urgente">🔴 Urgentes</option>
                                <option value="alta">🟡 Altas</option>
                                <option value="normal">🔵 Normales</option>
                            </select>

                            {/* Botón Crear Ruta con Pedidos del Día Seleccionado */}
                            {ordersByDate[selectedDate]?.filter(o => o.delivery_status !== 'entregado' && !o.dispatch_route_id).length > 0 && (
                                <button
                                    onClick={() => {
                                        const unassignedIds = ordersByDate[selectedDate]
                                            .filter(o => o.delivery_status !== 'entregado' && !o.dispatch_route_id)
                                            .map(o => o.id);
                                        handleOpenCreateRoute(selectedDate, unassignedIds);
                                    }}
                                    className="flex items-center gap-1.5 text-xs font-bold bg-indigo-600 text-white px-3 py-1.5 rounded-xl shadow transition hover:bg-indigo-700"
                                >
                                    <Truck className="w-3.5 h-3.5" />
                                    <span>Ruta con {ordersByDate[selectedDate].filter(o => o.delivery_status !== 'entregado' && !o.dispatch_route_id).length} pedidos del día</span>
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Tabla de Pedidos */}
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                            <div>
                                <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide">
                                    Pedidos Programados para Entrega
                                </h3>
                                <p className="text-xs text-slate-500">
                                    Total de pedidos listados: {filteredOrders.length}
                                </p>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse text-xs">
                                <thead>
                                    <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200 text-[11px] uppercase tracking-wider">
                                        <th className="p-3">Fecha Requerida</th>
                                        <th className="p-3">Prioridad</th>
                                        <th className="p-3">Cliente / Sucursal</th>
                                        <th className="p-3">Producto / Presentación</th>
                                        <th className="p-3 text-right">Cantidad Lbs</th>
                                        <th className="p-3 text-right">Cubetas</th>
                                        <th className="p-3 text-right">Precio / Lb</th>
                                        <th className="p-3">Estado / Ruta</th>
                                        <th className="p-3 text-center">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {loading ? (
                                        <tr>
                                            <td colSpan="9" className="p-8 text-center text-slate-400 font-medium">
                                                <RefreshCw className="w-5 h-5 mx-auto animate-spin text-indigo-600 mb-2" />
                                                Cargando pedidos de clientes...
                                            </td>
                                        </tr>
                                    ) : filteredOrders.length === 0 ? (
                                        <tr>
                                            <td colSpan="9" className="p-8 text-center text-slate-400 font-medium">
                                                No hay pedidos que coincidan con los filtros seleccionados.
                                            </td>
                                        </tr>
                                    ) : (

                                        filteredOrders.map((ord) => (
                                            <tr key={ord.id} className="hover:bg-slate-50/80 transition">
                                                <td className="p-3 font-semibold text-slate-800 whitespace-nowrap">
                                                    {ord.required_delivery_date ? ord.required_delivery_date.split('T')[0] : 'N/A'}
                                                </td>
                                                <td className="p-3 whitespace-nowrap">
                                                    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${
                                                        ord.priority === 'urgente'
                                                            ? 'bg-rose-100 text-rose-700'
                                                            : ord.priority === 'alta'
                                                            ? 'bg-amber-100 text-amber-700'
                                                            : 'bg-indigo-100 text-indigo-700'
                                                    }`}>
                                                        {ord.priority || 'Normal'}
                                                    </span>
                                                </td>
                                                <td className="p-3">
                                                    <div className="font-bold text-slate-900">{ord.customer_name}</div>
                                                    <div className="text-[11px] text-slate-500">
                                                        📍 {ord.branch_name || 'Sucursal Principal'}
                                                        {ord.branch_contact_person && ` | Preguntar por: ${ord.branch_contact_person}`}
                                                    </div>
                                                </td>
                                                <td className="p-3">
                                                    <div className="font-semibold text-slate-800">{ord.product_type}</div>
                                                    <div className="text-[11px] text-slate-500">{ord.presentation}</div>
                                                </td>
                                                <td className="p-3 text-right font-black text-indigo-700 whitespace-nowrap">
                                                    {parseFloat(ord.quantity_lbs || 0).toLocaleString()} Lbs
                                                </td>
                                                <td className="p-3 text-right font-bold text-slate-700 whitespace-nowrap">
                                                    {Math.ceil(parseFloat(ord.quantity_lbs || 0) / 30)}
                                                </td>
                                                <td className="p-3 text-right font-semibold text-slate-700 whitespace-nowrap">
                                                    <Money amount={parseFloat(ord.price_per_lb || 0)} />
                                                </td>
                                                <td className="p-3 whitespace-nowrap">
                                                    {ord.delivery_status === 'entregado' ? (
                                                        <span className="text-[10px] font-black bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-md flex items-center gap-1 w-max">
                                                            <CheckCircle2 className="w-3 h-3" /> Entregado
                                                        </span>
                                                    ) : ord.dispatch_route_id ? (
                                                        <span className="text-[10px] font-black bg-cyan-100 text-cyan-800 px-2 py-0.5 rounded-md flex items-center gap-1 w-max">
                                                            <Truck className="w-3 h-3" /> {ord.codigo_ruta || 'En Ruta'}
                                                        </span>
                                                    ) : (
                                                        <span className="text-[10px] font-black bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-md w-max block">
                                                            Pendiente Despacho
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="p-3 text-center whitespace-nowrap">
                                                    <div className="flex items-center justify-center gap-1">
                                                        <button
                                                            onClick={() => {
                                                                setEditingOrder(ord);
                                                                setOrderForm({
                                                                    customer_id: ord.customer_id,
                                                                    customer_branch_id: ord.customer_branch_id || '',
                                                                    customer_name: ord.customer_name,
                                                                    order_number: ord.order_number || '',
                                                                    product_type: ord.product_type,
                                                                    presentation: ord.presentation,
                                                                    quantity_lbs: ord.quantity_lbs,
                                                                    required_delivery_date: ord.required_delivery_date ? ord.required_delivery_date.split('T')[0] : '',
                                                                    priority: ord.priority || 'normal',
                                                                    price_per_lb: ord.price_per_lb || '',
                                                                    notes: ord.notes || ''
                                                                });
                                                                setCustomerSearch(ord.customer_name);
                                                                setOrderModalOpen(true);
                                                            }}
                                                            title="Editar Pedido"
                                                            className="p-1.5 hover:bg-indigo-50 text-indigo-600 rounded-lg transition"
                                                        >
                                                            <Edit3 className="w-3.5 h-3.5" />
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteOrder(ord.id)}
                                                            title="Eliminar Pedido"
                                                            className="p-1.5 hover:bg-rose-50 text-rose-600 rounded-lg transition"
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* ========================================================================= */}
            {/* PESTAÑA 2: PLANIFICADOR DE RUTAS & MAPA */}
            {/* ========================================================================= */}
            {activeTab === 'rutas' && (
                <div className="space-y-6">
                    {/* Selector de Rutas Existentes */}
                    <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <label className="text-xs font-bold text-slate-500 uppercase">
                                Seleccionar Ruta:
                            </label>
                            <select
                                value={selectedRoute?.id || ''}
                                onChange={(e) => {
                                    const r = routes.find(x => x.id === parseInt(e.target.value));
                                    setSelectedRoute(r || null);
                                }}
                                className="text-xs font-bold bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 outline-none"
                            >
                                <option value="">-- Seleccionar ruta de despacho --</option>
                                {routes.map(r => (
                                    <option key={r.id} value={r.id}>
                                        {r.codigo_ruta} ({r.fecha_despacho ? r.fecha_despacho.split('T')[0] : ''}) - {r.driver_name || 'Sin Chofer'} [{r.estado}]
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => handleOpenCreateRoute()}
                                className="flex items-center gap-1.5 text-xs font-bold bg-indigo-600 text-white px-3.5 py-2 rounded-xl shadow hover:bg-indigo-700 transition"
                            >
                                <Plus className="w-4 h-4" />
                                <span>Crear Nueva Ruta</span>
                            </button>

                            {selectedRoute && (
                                <button
                                    onClick={() => handleDeleteRoute(selectedRoute.id)}
                                    className="p-2 text-rose-600 hover:bg-rose-50 rounded-xl border border-rose-200 transition"
                                    title="Eliminar Ruta y Liberar Pedidos"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Detalle de la Ruta Activa */}
                    {routeDetail ? (
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                            {/* Columna Izquierda: Paradas y Secuencia (5 cols) */}
                            <div className="lg:col-span-5 space-y-4">
                                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                                    <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                                        <div>
                                            <span className="text-[10px] font-black uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                                                {routeDetail.codigo_ruta}
                                            </span>
                                            <h3 className="text-sm font-black text-slate-800 mt-1">
                                                Camión: {routeDetail.vehicle_codigo} ({routeDetail.vehicle_placa})
                                            </h3>
                                            <p className="text-xs text-slate-500">
                                                Chofer: <span className="font-semibold text-slate-700">{routeDetail.driver_name || 'No asignado'}</span>
                                            </p>
                                        </div>

                                        <button
                                            onClick={handleOptimizeRoute}
                                            disabled={optimizingRoute}
                                            className="flex items-center gap-1 text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-xl shadow-sm transition disabled:opacity-50"
                                            title="Reordena automáticamente priorizando urgentes y proximidad geográfica"
                                        >
                                            <Sparkles className={`w-3.5 h-3.5 ${optimizingRoute ? 'animate-spin' : ''}`} />
                                            <span>{optimizingRoute ? 'Optimizando...' : 'Optimizar Ruta'}</span>
                                        </button>
                                    </div>

                                    {/* Barra de Carga del Camión */}
                                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-1.5 text-xs">
                                        <div className="flex justify-between font-bold text-slate-700 text-[11px]">
                                            <span>Carga: {parseFloat(routeDetail.total_peso_lbs || 0).toLocaleString()} / {parseFloat(routeDetail.vehicle_capacidad_peso || 10000).toLocaleString()} Lbs</span>
                                            <span>{routeDetail.total_cubetas || 0} / {routeDetail.vehicle_capacidad_cubetas || 350} Cubetas</span>
                                        </div>
                                        <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full transition-all duration-300 ${
                                                    (routeDetail.total_peso_lbs || 0) > (routeDetail.vehicle_capacidad_peso || 10000)
                                                        ? 'bg-rose-600'
                                                        : 'bg-indigo-600'
                                                }`}
                                                style={{
                                                    width: `${Math.min(
                                                        ((routeDetail.total_peso_lbs || 0) / (routeDetail.vehicle_capacidad_peso || 10000)) * 100,
                                                        100
                                                    )}%`
                                                }}
                                            />
                                        </div>
                                    </div>

                                    {/* Lista de Paradas Ordenadas */}
                                    <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                                        {routeDetail.stops?.map((stop, idx) => (
                                            <div
                                                key={stop.id}
                                                className={`p-3 rounded-xl border transition ${
                                                    stop.estado_entrega === 'entregado'
                                                        ? 'bg-emerald-50/50 border-emerald-200'
                                                        : 'bg-white border-slate-200 hover:border-indigo-300'
                                                }`}
                                            >
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="flex items-start gap-2.5">
                                                        <span className={`w-6 h-6 rounded-full flex items-center justify-center font-black text-xs flex-shrink-0 ${
                                                            stop.estado_entrega === 'entregado'
                                                                ? 'bg-emerald-600 text-white'
                                                                : 'bg-indigo-600 text-white'
                                                        }`}>
                                                            {stop.estado_entrega === 'entregado' ? '✓' : stop.orden_visita}
                                                        </span>

                                                        <div>
                                                            <div className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                                                                <span>{stop.customer_name}</span>
                                                                {stop.prioridad === 'urgente' && (
                                                                    <span className="text-[9px] font-black bg-rose-100 text-rose-700 px-1.5 py-0.2 rounded">
                                                                        URGENTE
                                                                    </span>
                                                                )}
                                                            </div>

                                                            <p className="text-[11px] text-slate-500 mt-0.5">
                                                                📍 {stop.branch_name || 'Sucursal'}
                                                                {stop.branch_address && ` - ${stop.branch_address}`}
                                                            </p>

                                                            {stop.branch_contact_person && (
                                                                <p className="text-[11px] text-slate-600 font-medium mt-0.5">
                                                                    👤 Preguntar por: <span className="font-bold text-indigo-900">{stop.branch_contact_person}</span>
                                                                    {stop.branch_contact_phone && ` (${stop.branch_contact_phone})`}
                                                                </p>
                                                            )}

                                                            <div className="text-[11px] text-indigo-700 font-bold mt-1">
                                                                📦 {stop.quantity_lbs || 0} Lbs ({Math.ceil((stop.quantity_lbs || 0) / 30)} cubetas) - {stop.product_type}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Controles para reordenar arriba/abajo */}
                                                    <div className="flex flex-col gap-1 flex-shrink-0">
                                                        <button
                                                            disabled={idx === 0}
                                                            onClick={() => handleMoveStop(idx, -1)}
                                                            className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20 hover:bg-slate-100 rounded"
                                                            title="Subir orden"
                                                        >
                                                            <ArrowUp className="w-3.5 h-3.5" />
                                                        </button>
                                                        <button
                                                            disabled={idx === routeDetail.stops.length - 1}
                                                            onClick={() => handleMoveStop(idx, 1)}
                                                            className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20 hover:bg-slate-100 rounded"
                                                            title="Bajar orden"
                                                        >
                                                            <ArrowDown className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* Columna Derecha: Mapa Interactivo de la Ruta (7 cols) */}
                            <div className="lg:col-span-7 space-y-4">
                                <DispatchRouteMap
                                    stops={routeDetail.stops || []}
                                    height="580px"
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="bg-white p-12 text-center rounded-2xl border border-slate-200 text-slate-400">
                            <Navigation className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                            <h3 className="font-bold text-slate-700 text-base">No hay ninguna ruta seleccionada</h3>
                            <p className="text-xs text-slate-500 mt-1">
                                Seleccione una ruta en el menú superior o cree una nueva con los pedidos del día.
                            </p>
                        </div>
                    )}
                </div>
            )}

            {/* ========================================================================= */}
            {/* PESTAÑA 3: FLOTA Y MANTENIMIENTO */}
            {/* ========================================================================= */}
            {activeTab === 'flota' && (
                <div className="space-y-6">
                    {/* Header Sección Flota */}
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-base font-black text-slate-900">Camiones y Vehículos de Reparto</h2>
                            <p className="text-xs text-slate-500">Control de capacidad de carga, refrigeración Termo-King y estado operativo</p>
                        </div>

                        <div className="flex gap-2">
                            <button
                                onClick={() => {
                                    setVehicleForm({
                                        codigo: '',
                                        placa: '',
                                        marca: '',
                                        modelo: '',
                                        anio: new Date().getFullYear(),
                                        tipo_vehiculo: 'camion_refrigerado',
                                        capacidad_peso_lbs: 10000,
                                        capacidad_cubetas: 350,
                                        tiene_termo_king: true,
                                        odometro_actual: 0,
                                        estado: 'disponible',
                                        notas: ''
                                    });
                                    setEditingVehicle(null);
                                    setVehicleModalOpen(true);
                                }}
                                className="flex items-center gap-1.5 text-xs font-bold bg-indigo-600 text-white px-3.5 py-2 rounded-xl shadow hover:bg-indigo-700 transition"
                            >
                                <Plus className="w-4 h-4" />
                                <span>Agregar Vehículo</span>
                            </button>

                            <button
                                onClick={() => {
                                    setMaintenanceForm({
                                        vehicle_id: vehicles[0]?.id || '',
                                        tipo_mantenimiento: 'preventivo',
                                        fecha_programada: new Date().toISOString().split('T')[0],
                                        fecha_realizada: '',
                                        odometro: '',
                                        taller_proveedor: '',
                                        costo_total: 0,
                                        descripcion: '',
                                        repuestos_cambiados: '',
                                        estado: 'programado',
                                        proximo_servicio_km: '',
                                        proximo_servicio_fecha: '',
                                        notas: ''
                                    });
                                    setMaintenanceModalOpen(true);
                                }}
                                className="flex items-center gap-1.5 text-xs font-bold bg-amber-600 text-white px-3.5 py-2 rounded-xl shadow hover:bg-amber-700 transition"
                            >
                                <Wrench className="w-4 h-4" />
                                <span>Registrar Mantenimiento</span>
                            </button>
                        </div>
                    </div>

                    {/* Tarjetas de Camiones */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {vehicles.map((v) => (
                            <div
                                key={v.id}
                                className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3 hover:shadow-md transition"
                            >
                                <div className="flex items-start justify-between">
                                    <div>
                                        <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-indigo-50 text-indigo-700">
                                            {v.codigo}
                                        </span>
                                        <h3 className="text-base font-black text-slate-900 mt-1">{v.placa}</h3>
                                        <p className="text-xs text-slate-500">{v.marca} {v.modelo} ({v.anio})</p>
                                    </div>

                                    <span className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-full ${
                                        v.estado === 'disponible'
                                            ? 'bg-emerald-100 text-emerald-700'
                                            : v.estado === 'en_mantenimiento'
                                            ? 'bg-rose-100 text-rose-700 animate-pulse'
                                            : v.estado === 'en_ruta'
                                            ? 'bg-cyan-100 text-cyan-800'
                                            : 'bg-slate-100 text-slate-600'
                                    }`}>
                                        {v.estado === 'en_mantenimiento' ? '⚠️ En Taller' : v.estado}
                                    </span>
                                </div>

                                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-1.5 text-xs text-slate-600">
                                    <div className="flex justify-between">
                                        <span>Capacidad Peso:</span>
                                        <strong className="text-slate-900">{parseFloat(v.capacidad_peso_lbs).toLocaleString()} Lbs</strong>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>Capacidad Cubetas:</span>
                                        <strong className="text-slate-900">{v.capacidad_cubetas} Cubetas (30 Lb)</strong>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>Termo-King Refrigeración:</span>
                                        <strong className={v.tiene_termo_king ? 'text-emerald-600' : 'text-slate-400'}>
                                            {v.tiene_termo_king ? '✓ Sí (2-4°C)' : 'No'}
                                        </strong>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>Odómetro Actual:</span>
                                        <strong className="text-indigo-700">{parseFloat(v.odometro_actual || 0).toLocaleString()} Km</strong>
                                    </div>
                                </div>

                                {v.notas && (
                                    <p className="text-[11px] text-slate-500 italic bg-slate-50/50 p-2 rounded-lg">
                                        "{v.notas}"
                                    </p>
                                )}

                                <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                                    <button
                                        onClick={() => {
                                            setEditingVehicle(v);
                                            setVehicleForm({
                                                codigo: v.codigo,
                                                placa: v.placa,
                                                marca: v.marca || '',
                                                modelo: v.modelo || '',
                                                anio: v.anio || new Date().getFullYear(),
                                                tipo_vehiculo: v.tipo_vehiculo || 'camion_refrigerado',
                                                capacidad_peso_lbs: v.capacidad_peso_lbs,
                                                capacidad_cubetas: v.capacidad_cubetas,
                                                tiene_termo_king: !!v.tiene_termo_king,
                                                odometro_actual: v.odometro_actual,
                                                estado: v.estado,
                                                notas: v.notas || ''
                                            });
                                            setVehicleModalOpen(true);
                                        }}
                                        className="text-xs font-bold text-indigo-600 hover:underline"
                                    >
                                        Editar
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Historial de Mantenimientos */}
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                            <div>
                                <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide">
                                    Historial y Planificación de Mantenimientos
                                </h3>
                                <p className="text-xs text-slate-500">Mantenimientos preventivos, correctivos, termo-king y cambio de fluidos</p>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse text-xs">
                                <thead>
                                    <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200 text-[11px] uppercase tracking-wider">
                                        <th className="p-3">Vehículo</th>
                                        <th className="p-3">Tipo</th>
                                        <th className="p-3">Fecha Programada</th>
                                        <th className="p-3">Fecha Realizada</th>
                                        <th className="p-3">Odómetro</th>
                                        <th className="p-3">Taller / Proveedor</th>
                                        <th className="p-3 text-right">Costo</th>
                                        <th className="p-3">Estado</th>
                                        <th className="p-3">Descripción</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {maintenanceLogs.length === 0 ? (
                                        <tr>
                                            <td colSpan="9" className="p-6 text-center text-slate-400 font-medium">
                                                No hay registros de mantenimiento registrados.
                                            </td>
                                        </tr>
                                    ) : (
                                        maintenanceLogs.map((m) => (
                                            <tr key={m.id} className="hover:bg-slate-50/80 transition">
                                                <td className="p-3 font-bold text-slate-900 whitespace-nowrap">
                                                    {m.vehicle_codigo} ({m.vehicle_placa})
                                                </td>
                                                <td className="p-3 uppercase font-semibold text-slate-700 whitespace-nowrap">
                                                    {m.tipo_mantenimiento}
                                                </td>
                                                <td className="p-3 font-semibold text-slate-700 whitespace-nowrap">
                                                    {m.fecha_programada ? m.fecha_programada.split('T')[0] : ''}
                                                </td>
                                                <td className="p-3 font-semibold text-emerald-700 whitespace-nowrap">
                                                    {m.fecha_realizada ? m.fecha_realizada.split('T')[0] : '-'}
                                                </td>
                                                <td className="p-3 font-mono text-slate-700 whitespace-nowrap">
                                                    {m.odometro ? `${parseFloat(m.odometro).toLocaleString()} Km` : '-'}
                                                </td>
                                                <td className="p-3 text-slate-800 whitespace-nowrap">
                                                    {m.taller_proveedor || '-'}
                                                </td>
                                                <td className="p-3 text-right font-bold text-slate-900 whitespace-nowrap">
                                                    <Money amount={parseFloat(m.costo_total || 0)} />
                                                </td>
                                                <td className="p-3 whitespace-nowrap">
                                                    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${
                                                        m.estado === 'completado'
                                                            ? 'bg-emerald-100 text-emerald-800'
                                                            : m.estado === 'en_proceso'
                                                            ? 'bg-rose-100 text-rose-800 animate-pulse'
                                                            : 'bg-amber-100 text-amber-800'
                                                    }`}>
                                                        {m.estado}
                                                    </span>
                                                </td>
                                                <td className="p-3 text-slate-600 max-w-xs truncate">
                                                    {m.descripcion}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* ========================================================================= */}
            {/* PESTAÑA 4: MODO MOTORISTA (MÓVIL) */}
            {/* ========================================================================= */}
            {activeTab === 'motorista' && (
                <div className="space-y-4 max-w-2xl mx-auto">
                    {/* Header Móvil del Chofer */}
                    <div className="bg-gradient-to-br from-indigo-900 to-slate-900 p-5 rounded-3xl text-white shadow-lg space-y-3">
                        <div className="flex items-center justify-between">
                            <div>
                                <span className="text-[10px] font-black uppercase tracking-wider text-indigo-300">
                                    Hoja de Reparto del Chofer
                                </span>
                                <h2 className="text-lg font-black mt-0.5">
                                    {routeDetail?.driver_name || 'Motorista Asignado'}
                                </h2>
                                <p className="text-xs text-indigo-200">
                                    🚛 {routeDetail?.vehicle_codigo} ({routeDetail?.vehicle_placa})
                                </p>
                            </div>

                            <div className="text-right">
                                <span className="text-2xl font-black text-emerald-400">
                                    {routeDetail?.stops?.filter(s => s.estado_entrega === 'entregado').length || 0}
                                    <span className="text-sm text-slate-300"> / {routeDetail?.stops?.length || 0}</span>
                                </span>
                                <p className="text-[10px] font-bold text-slate-300">Entregas Realizadas</p>
                            </div>
                        </div>

                        {/* Selector de Ruta del día si hay más de una */}
                        {driverRoutes.length > 1 && (
                            <select
                                value={routeDetail?.id || ''}
                                onChange={(e) => fetchRouteDetail(e.target.value)}
                                className="w-full text-xs font-bold bg-white/10 border border-white/20 rounded-xl p-2 text-white outline-none"
                            >
                                {driverRoutes.map(r => (
                                    <option key={r.id} value={r.id} className="text-slate-900">
                                        {r.codigo_ruta} ({r.total_stops} paradas)
                                    </option>
                                ))}
                            </select>
                        )}
                    </div>

                    {/* Lista de Paradas del Motorista */}
                    <div className="space-y-3">
                        {routeDetail?.stops?.map((stop) => {
                            const isDelivered = stop.estado_entrega === 'entregado';
                            const gmapsUrl = stop.branch_latitude && stop.branch_longitude
                                ? `https://www.google.com/maps/dir/?api=1&destination=${stop.branch_latitude},${stop.branch_longitude}`
                                : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((stop.branch_address || '') + ', ' + (stop.customer_name || ''))}`;
                            const wazeUrl = stop.branch_latitude && stop.branch_longitude
                                ? `https://waze.com/ul?ll=${stop.branch_latitude},${stop.branch_longitude}&navigate=yes`
                                : null;

                            return (
                                <div
                                    key={stop.id}
                                    className={`p-4 rounded-3xl border shadow-sm transition space-y-3 ${
                                        isDelivered
                                            ? 'bg-emerald-50/60 border-emerald-200'
                                            : 'bg-white border-slate-200'
                                    }`}
                                >
                                    {/* Cabecera de la parada */}
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex items-center gap-2.5">
                                            <span className={`w-8 h-8 rounded-2xl flex items-center justify-center font-black text-sm text-white shadow-sm ${
                                                isDelivered ? 'bg-emerald-600' : 'bg-indigo-600'
                                            }`}>
                                                {isDelivered ? '✓' : stop.orden_visita}
                                            </span>
                                            <div>
                                                <h3 className="text-sm font-black text-slate-900 leading-tight">
                                                    {stop.customer_name}
                                                </h3>
                                                <p className="text-xs text-slate-600 font-semibold">
                                                    📍 {stop.branch_name || 'Sucursal Principal'}
                                                </p>
                                            </div>
                                        </div>

                                        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${
                                            isDelivered
                                                ? 'bg-emerald-200 text-emerald-800'
                                                : stop.prioridad === 'urgente'
                                                ? 'bg-rose-100 text-rose-700'
                                                : 'bg-indigo-100 text-indigo-700'
                                        }`}>
                                            {isDelivered ? 'Entregado' : (stop.prioridad || 'Normal')}
                                        </span>
                                    </div>

                                    {/* Dirección */}
                                    {stop.branch_address && (
                                        <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                                            {stop.branch_address}
                                        </div>
                                    )}

                                    {/* Datos de contacto: "¿Por quién preguntar?" y Teléfono */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-indigo-50/50 p-2.5 rounded-2xl border border-indigo-100 text-xs">
                                        <div>
                                            <span className="text-[10px] font-bold text-indigo-600 uppercase block">
                                                Preguntar por:
                                            </span>
                                            <span className="font-black text-slate-900">
                                                {stop.recibido_por || stop.branch_contact_person || 'Encargado de Recepción'}
                                            </span>
                                        </div>

                                        {(stop.telefono_receptor || stop.branch_contact_phone || stop.customer_phone) && (
                                            <div>
                                                <span className="text-[10px] font-bold text-indigo-600 uppercase block">
                                                    Teléfono receptor:
                                                </span>
                                                <a
                                                    href={`tel:${stop.telefono_receptor || stop.branch_contact_phone || stop.customer_phone}`}
                                                    className="font-bold text-indigo-700 hover:underline flex items-center gap-1 mt-0.5"
                                                >
                                                    <Phone className="w-3 h-3 text-emerald-600" />
                                                    <span>{stop.telefono_receptor || stop.branch_contact_phone || stop.customer_phone}</span>
                                                </a>
                                            </div>
                                        )}
                                    </div>

                                    {/* Detalle del producto */}
                                    <div className="flex items-center justify-between text-xs bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                                        <span className="font-semibold text-slate-700">{stop.product_type}</span>
                                        <span className="font-black text-indigo-700">
                                            {stop.quantity_lbs} Lbs ({Math.ceil((stop.quantity_lbs || 0) / 30)} cubetas)
                                        </span>
                                    </div>

                                    {/* Botones de Navegación Externa */}
                                    <div className="grid grid-cols-2 gap-2">
                                        <a
                                            href={gmapsUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center justify-center gap-1.5 text-xs font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 py-2 rounded-xl border border-blue-200 transition text-center"
                                        >
                                            <Navigation className="w-3.5 h-3.5" />
                                            <span>Google Maps</span>
                                        </a>

                                        {wazeUrl ? (
                                            <a
                                                href={wazeUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center justify-center gap-1.5 text-xs font-bold bg-cyan-50 text-cyan-700 hover:bg-cyan-100 py-2 rounded-xl border border-cyan-200 transition text-center"
                                            >
                                                <ExternalLink className="w-3.5 h-3.5" />
                                                <span>Waze</span>
                                            </a>
                                        ) : (
                                            <div className="flex items-center justify-center text-[10px] text-slate-400 bg-slate-50 rounded-xl border border-slate-100">
                                                Sin GPS (Waze N/A)
                                            </div>
                                        )}
                                    </div>

                                    {/* Botón Principal de Confirmación / Escaneo QR */}
                                    {!isDelivered ? (
                                        <button
                                            onClick={() => {
                                                setSelectedStopToDeliver(stop);
                                                setDeliveryScannerModalOpen(true);
                                            }}
                                            className="w-full flex items-center justify-center gap-2 text-xs font-black bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-2xl shadow-md transition"
                                        >
                                            <QrCode className="w-4 h-4" />
                                            <span>Escanear QR DTE / Confirmar Entrega</span>
                                        </button>
                                    ) : (
                                        <div className="bg-emerald-100/80 p-2.5 rounded-2xl border border-emerald-300 text-emerald-900 text-xs flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                                                <div>
                                                    <span className="font-bold">Entrega Registrada</span>
                                                    {stop.recibido_por && (
                                                        <span className="text-[11px] block text-emerald-800">
                                                            Recibió: {stop.recibido_por} ({stop.telefono_receptor || 'Sin tel.'})
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            {stop.dte_codigo_generacion && (
                                                <span className="text-[10px] font-mono font-bold bg-white px-2 py-0.5 rounded border border-emerald-300">
                                                    DTE: {stop.dte_codigo_generacion.substring(0, 8)}...
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ========================================================================= */}
            {/* MODAL 1: NUEVO / EDITAR PEDIDO DE CLIENTE */}
            {/* ========================================================================= */}
            <Modal
                isOpen={orderModalOpen}
                onClose={() => setOrderModalOpen(false)}
                title={editingOrder ? 'Editar Pedido de Cliente' : 'Nuevo Pedido de Ovoproductos'}
                size="lg"
            >
                <form onSubmit={handleSaveOrder} className="space-y-4">
                    {/* Buscador de Cliente */}
                    <div>
                        <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                            Cliente *
                        </label>
                        <div className="relative">
                            <input
                                type="text"
                                required
                                value={customerSearch}
                                onChange={(e) => handleCustomerSearch(e.target.value)}
                                placeholder="Buscar cliente por nombre o nombre comercial..."
                                className="w-full text-xs font-semibold border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:border-indigo-500 outline-none"
                            />
                            {searchingCustomer && (
                                <RefreshCw className="w-4 h-4 absolute right-3 top-2.5 text-slate-400 animate-spin" />
                            )}
                        </div>

                        {customerOptions.length > 0 && (
                            <div className="mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-40 overflow-y-auto divide-y divide-slate-100 z-10 relative">
                                {customerOptions.map(c => (
                                    <button
                                        key={c.id}
                                        type="button"
                                        onClick={() => handleSelectCustomer(c)}
                                        className="w-full text-left p-2 hover:bg-indigo-50 text-xs font-medium text-slate-800 flex justify-between"
                                    >
                                        <span>{c.nombre} {c.nombre_comercial && `(${c.nombre_comercial})`}</span>
                                        <span className="text-[10px] text-indigo-600 font-bold">Seleccionar</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Sucursal del Cliente */}
                    <div>
                        <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                            Sucursal de Entrega (Dirección / Destino)
                        </label>
                        <select
                            value={orderForm.customer_branch_id}
                            onChange={(e) => setOrderForm(prev => ({ ...prev, customer_branch_id: e.target.value }))}
                            className="w-full text-xs font-medium border border-slate-200 rounded-xl px-3 py-2 text-slate-800 outline-none"
                        >
                            <option value="">-- Sucursal Principal / Sin especificar --</option>
                            {customerBranches.map(b => (
                                <option key={b.id} value={b.id}>
                                    {b.nombre} - {b.direccion || 'Sin dirección'}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                                Tipo de Producto *
                            </label>
                            <select
                                required
                                value={orderForm.product_type}
                                onChange={(e) => setOrderForm(prev => ({ ...prev, product_type: e.target.value }))}
                                className="w-full text-xs font-semibold border border-slate-200 rounded-xl px-3 py-2 text-slate-800 outline-none"
                            >
                                {PRODUCT_PROFILES.map(p => (
                                    <option key={p} value={p}>{p}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                                Presentación
                            </label>
                            <select
                                value={orderForm.presentation}
                                onChange={(e) => setOrderForm(prev => ({ ...prev, presentation: e.target.value }))}
                                className="w-full text-xs font-medium border border-slate-200 rounded-xl px-3 py-2 text-slate-800 outline-none"
                            >
                                {PRESENTATIONS.map(p => (
                                    <option key={p} value={p}>{p}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                                Cantidad (Lbs) *
                            </label>
                            <input
                                type="number"
                                required
                                step="any"
                                min="1"
                                value={orderForm.quantity_lbs}
                                onChange={(e) => setOrderForm(prev => ({ ...prev, quantity_lbs: e.target.value }))}
                                placeholder="Ej: 3000"
                                className="w-full text-xs font-bold border border-slate-200 rounded-xl px-3 py-2 text-indigo-700 outline-none"
                            />
                            {orderForm.quantity_lbs && (
                                <span className="text-[10px] text-slate-500 block mt-0.5">
                                    ≈ {Math.ceil(parseFloat(orderForm.quantity_lbs) / 30)} cubetas de 30 Lb
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                                Fecha Requerida *
                            </label>
                            <input
                                type="date"
                                required
                                value={orderForm.required_delivery_date}
                                onChange={(e) => setOrderForm(prev => ({ ...prev, required_delivery_date: e.target.value }))}
                                className="w-full text-xs font-medium border border-slate-200 rounded-xl px-3 py-2 text-slate-800 outline-none"
                            />
                        </div>

                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                                Prioridad
                            </label>
                            <select
                                value={orderForm.priority}
                                onChange={(e) => setOrderForm(prev => ({ ...prev, priority: e.target.value }))}
                                className="w-full text-xs font-bold border border-slate-200 rounded-xl px-3 py-2 text-slate-800 outline-none"
                            >
                                <option value="normal">Normal</option>
                                <option value="alta">Alta</option>
                                <option value="urgente">Urgente</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                                Precio acordado / Lb
                            </label>
                            <MoneyInput
                                value={orderForm.price_per_lb}
                                onChange={(val) => setOrderForm(prev => ({ ...prev, price_per_lb: val }))}
                                placeholder="0.0000"
                                className="w-full text-xs font-semibold border border-slate-200 rounded-xl px-3 py-2 text-slate-800 outline-none"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                            Notas de Entrega / Referencias
                        </label>
                        <textarea
                            rows="2"
                            value={orderForm.notes}
                            onChange={(e) => setOrderForm(prev => ({ ...prev, notes: e.target.value }))}
                            placeholder="Indicaciones especiales de entrega..."
                            className="w-full text-xs border border-slate-200 rounded-xl p-2 text-slate-800 outline-none"
                        />
                    </div>

                    <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                        <button
                            type="button"
                            onClick={() => setOrderModalOpen(false)}
                            className="text-xs font-semibold text-slate-600 px-4 py-2 hover:bg-slate-100 rounded-xl transition"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            className="text-xs font-bold bg-indigo-600 text-white px-5 py-2.5 rounded-xl shadow hover:bg-indigo-700 transition"
                        >
                            {editingOrder ? 'Guardar Cambios' : 'Registrar Pedido'}
                        </button>
                    </div>
                </form>
            </Modal>

            {/* ========================================================================= */}
            {/* MODAL 2: CREAR / CONFIGURAR RUTA DE DESPACHO */}
            {/* ========================================================================= */}
            <Modal
                isOpen={routeModalOpen}
                onClose={() => setRouteModalOpen(false)}
                title="Planificar Ruta de Despacho"
                size="xl"
            >
                <form onSubmit={handleSaveRoute} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                                Fecha de Despacho *
                            </label>
                            <input
                                type="date"
                                required
                                value={routeForm.fecha_despacho}
                                onChange={(e) => setRouteForm(prev => ({ ...prev, fecha_despacho: e.target.value }))}
                                className="w-full text-xs font-medium border border-slate-200 rounded-xl px-3 py-2 text-slate-800 outline-none"
                            />
                        </div>

                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                                Camión Asignado *
                            </label>
                            <select
                                required
                                value={routeForm.vehicle_id}
                                onChange={(e) => setRouteForm(prev => ({ ...prev, vehicle_id: e.target.value }))}
                                className="w-full text-xs font-bold border border-slate-200 rounded-xl px-3 py-2 text-slate-800 outline-none"
                            >
                                <option value="">-- Seleccionar Camión --</option>
                                {vehicles.map(v => (
                                    <option
                                        key={v.id}
                                        value={v.id}
                                        disabled={v.estado === 'en_mantenimiento'}
                                    >
                                        {v.codigo} ({v.placa}) - Cap: {parseFloat(v.capacidad_peso_lbs).toLocaleString()} Lbs {v.estado === 'en_mantenimiento' ? '[EN TALLER]' : ''}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                                Motorista
                            </label>
                            <select
                                value={routeForm.driver_id}
                                onChange={(e) => {
                                    const uid = e.target.value;
                                    const u = factoryUsers.find(x => x.id === parseInt(uid));
                                    setRouteForm(prev => ({
                                        ...prev,
                                        driver_id: uid,
                                        driver_name: u ? u.nombre : prev.driver_name
                                    }));
                                }}
                                className="w-full text-xs font-medium border border-slate-200 rounded-xl px-3 py-2 text-slate-800 outline-none"
                            >
                                <option value="">-- Seleccionar de usuarios de planta --</option>
                                {factoryUsers.map(u => (
                                    <option key={u.id} value={u.id}>{u.nombre} ({u.role_name})</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Alerta de Capacidad en Tiempo Real */}
                    {selectedVehicleForRoute && (
                        <div className={`p-3 rounded-xl border text-xs space-y-1.5 ${
                            calculatedLoadForNewRoute.isOverload
                                ? 'bg-rose-50 border-rose-200 text-rose-800'
                                : 'bg-slate-50 border-slate-200 text-slate-700'
                        }`}>
                            <div className="flex justify-between font-bold">
                                <span>Capacidad Utilizada del Camión {selectedVehicleForRoute.codigo}:</span>
                                <span>
                                    {calculatedLoadForNewRoute.totalLbs.toLocaleString()} / {calculatedLoadForNewRoute.maxLbs.toLocaleString()} Lbs ({calculatedLoadForNewRoute.pctLbs.toFixed(1)}%)
                                </span>
                            </div>
                            <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                                <div
                                    className={`h-full ${calculatedLoadForNewRoute.isOverload ? 'bg-rose-600' : 'bg-indigo-600'}`}
                                    style={{ width: `${calculatedLoadForNewRoute.pctLbs}%` }}
                                />
                            </div>
                            {calculatedLoadForNewRoute.isOverload && (
                                <p className="text-[11px] text-rose-600 font-bold flex items-center gap-1">
                                    <AlertTriangle className="w-3.5 h-3.5" />
                                    ¡Atención! La carga total excede la capacidad máxima del camión.
                                </p>
                            )}
                        </div>
                    )}

                    {/* Selección de Pedidos para la Ruta */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-black text-slate-800 uppercase tracking-wide">
                                Seleccionar Pedidos para esta Ruta ({routeForm.selectedOrderIds.length} seleccionados)
                            </label>
                        </div>

                        <div className="border border-slate-200 rounded-xl max-h-60 overflow-y-auto divide-y divide-slate-100">
                            {orders.filter(o => o.delivery_status !== 'entregado').map(ord => {
                                const isSelected = routeForm.selectedOrderIds.includes(ord.id);
                                return (
                                    <label
                                        key={ord.id}
                                        className={`flex items-center justify-between p-2.5 cursor-pointer text-xs transition ${
                                            isSelected ? 'bg-indigo-50/70' : 'hover:bg-slate-50'
                                        }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setRouteForm(prev => ({
                                                            ...prev,
                                                            selectedOrderIds: [...prev.selectedOrderIds, ord.id]
                                                        }));
                                                    } else {
                                                        setRouteForm(prev => ({
                                                            ...prev,
                                                            selectedOrderIds: prev.selectedOrderIds.filter(id => id !== ord.id)
                                                        }));
                                                    }
                                                }}
                                                className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                                            />
                                            <div>
                                                <div className="font-bold text-slate-900">{ord.customer_name}</div>
                                                <div className="text-[11px] text-slate-500">
                                                    📍 {ord.branch_name || 'Sucursal Principal'} | Fecha: {ord.required_delivery_date?.split('T')[0]}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="text-right">
                                            <span className="font-black text-indigo-700">{ord.quantity_lbs} Lbs</span>
                                            <span className="text-[10px] text-slate-500 block">
                                                {Math.ceil(parseFloat(ord.quantity_lbs || 0) / 30)} Cubetas
                                            </span>
                                        </div>
                                    </label>
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                        <button
                            type="button"
                            onClick={() => setRouteModalOpen(false)}
                            className="text-xs font-semibold text-slate-600 px-4 py-2 hover:bg-slate-100 rounded-xl transition"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            className="text-xs font-bold bg-emerald-600 text-white px-5 py-2.5 rounded-xl shadow hover:bg-emerald-700 transition"
                        >
                            Crear Ruta de Despacho
                        </button>
                    </div>
                </form>
            </Modal>

            {/* ========================================================================= */}
            {/* MODAL 3: AGREGAR / EDITAR VEHÍCULO */}
            {/* ========================================================================= */}
            <Modal
                isOpen={vehicleModalOpen}
                onClose={() => setVehicleModalOpen(false)}
                title={editingVehicle ? 'Editar Vehículo' : 'Agregar Vehículo a la Flota'}
                size="md"
            >
                <form onSubmit={handleSaveVehicle} className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                                Código de Flota *
                            </label>
                            <input
                                type="text"
                                required
                                value={vehicleForm.codigo}
                                onChange={(e) => setVehicleForm(prev => ({ ...prev, codigo: e.target.value.toUpperCase() }))}
                                placeholder="Ej: CAM-01"
                                className="w-full text-xs font-bold border border-slate-200 rounded-xl px-3 py-2 text-slate-800 outline-none uppercase"
                            />
                        </div>

                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                                Placa *
                            </label>
                            <input
                                type="text"
                                required
                                value={vehicleForm.placa}
                                onChange={(e) => setVehicleForm(prev => ({ ...prev, placa: e.target.value.toUpperCase() }))}
                                placeholder="Ej: C-104928"
                                className="w-full text-xs font-bold border border-slate-200 rounded-xl px-3 py-2 text-slate-800 outline-none uppercase"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                                Marca
                            </label>
                            <input
                                type="text"
                                value={vehicleForm.marca}
                                onChange={(e) => setVehicleForm(prev => ({ ...prev, marca: e.target.value }))}
                                placeholder="Ej: Hino"
                                className="w-full text-xs font-medium border border-slate-200 rounded-xl px-3 py-2 text-slate-800 outline-none"
                            />
                        </div>

                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                                Modelo
                            </label>
                            <input
                                type="text"
                                value={vehicleForm.modelo}
                                onChange={(e) => setVehicleForm(prev => ({ ...prev, modelo: e.target.value }))}
                                placeholder="Ej: 300 Serie 816"
                                className="w-full text-xs font-medium border border-slate-200 rounded-xl px-3 py-2 text-slate-800 outline-none"
                            />
                        </div>

                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                                Año
                            </label>
                            <input
                                type="number"
                                value={vehicleForm.anio}
                                onChange={(e) => setVehicleForm(prev => ({ ...prev, anio: e.target.value }))}
                                className="w-full text-xs font-medium border border-slate-200 rounded-xl px-3 py-2 text-slate-800 outline-none"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                                Capacidad Peso (Lbs)
                            </label>
                            <input
                                type="number"
                                required
                                value={vehicleForm.capacidad_peso_lbs}
                                onChange={(e) => setVehicleForm(prev => ({ ...prev, capacidad_peso_lbs: e.target.value }))}
                                className="w-full text-xs font-bold border border-slate-200 rounded-xl px-3 py-2 text-slate-800 outline-none"
                            />
                        </div>

                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                                Capacidad Cubetas (30 Lb)
                            </label>
                            <input
                                type="number"
                                required
                                value={vehicleForm.capacidad_cubetas}
                                onChange={(e) => setVehicleForm(prev => ({ ...prev, capacidad_cubetas: e.target.value }))}
                                className="w-full text-xs font-bold border border-slate-200 rounded-xl px-3 py-2 text-slate-800 outline-none"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                                Odómetro Actual (Km)
                            </label>
                            <input
                                type="number"
                                value={vehicleForm.odometro_actual}
                                onChange={(e) => setVehicleForm(prev => ({ ...prev, odometro_actual: e.target.value }))}
                                className="w-full text-xs font-medium border border-slate-200 rounded-xl px-3 py-2 text-slate-800 outline-none"
                            />
                        </div>

                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                                Estado Inicial
                            </label>
                            <select
                                value={vehicleForm.estado}
                                onChange={(e) => setVehicleForm(prev => ({ ...prev, estado: e.target.value }))}
                                className="w-full text-xs font-bold border border-slate-200 rounded-xl px-3 py-2 text-slate-800 outline-none"
                            >
                                <option value="disponible">Disponible</option>
                                <option value="en_mantenimiento">En Mantenimiento</option>
                                <option value="inactivo">Inactivo</option>
                            </select>
                        </div>
                    </div>

                    <label className="flex items-center gap-2 cursor-pointer pt-1">
                        <input
                            type="checkbox"
                            checked={vehicleForm.tiene_termo_king}
                            onChange={(e) => setVehicleForm(prev => ({ ...prev, tiene_termo_king: e.target.checked }))}
                            className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                        />
                        <span className="text-xs font-bold text-slate-700">
                            Equipado con Termo-King de Refrigeración para Ovoproductos (2°C - 4°C)
                        </span>
                    </label>

                    <div>
                        <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                            Notas / Características
                        </label>
                        <textarea
                            rows="2"
                            value={vehicleForm.notas}
                            onChange={(e) => setVehicleForm(prev => ({ ...prev, notas: e.target.value }))}
                            placeholder="Detalles adicionales del vehículo..."
                            className="w-full text-xs border border-slate-200 rounded-xl p-2 text-slate-800 outline-none"
                        />
                    </div>

                    <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                        <button
                            type="button"
                            onClick={() => setVehicleModalOpen(false)}
                            className="text-xs font-semibold text-slate-600 px-4 py-2 hover:bg-slate-100 rounded-xl transition"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            className="text-xs font-bold bg-indigo-600 text-white px-5 py-2.5 rounded-xl shadow hover:bg-indigo-700 transition"
                        >
                            {editingVehicle ? 'Guardar Cambios' : 'Guardar Vehículo'}
                        </button>
                    </div>
                </form>
            </Modal>

            {/* ========================================================================= */}
            {/* MODAL 4: REGISTRAR MANTENIMIENTO */}
            {/* ========================================================================= */}
            <Modal
                isOpen={maintenanceModalOpen}
                onClose={() => setMaintenanceModalOpen(false)}
                title="Registrar Mantenimiento de Vehículo"
                size="lg"
            >
                <form onSubmit={handleSaveMaintenance} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                                Vehículo *
                            </label>
                            <select
                                required
                                value={maintenanceForm.vehicle_id}
                                onChange={(e) => setMaintenanceForm(prev => ({ ...prev, vehicle_id: e.target.value }))}
                                className="w-full text-xs font-bold border border-slate-200 rounded-xl px-3 py-2 text-slate-800 outline-none"
                            >
                                <option value="">-- Seleccionar --</option>
                                {vehicles.map(v => (
                                    <option key={v.id} value={v.id}>{v.codigo} - {v.placa}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                                Tipo de Servicio *
                            </label>
                            <select
                                value={maintenanceForm.tipo_mantenimiento}
                                onChange={(e) => setMaintenanceForm(prev => ({ ...prev, tipo_mantenimiento: e.target.value }))}
                                className="w-full text-xs font-semibold border border-slate-200 rounded-xl px-3 py-2 text-slate-800 outline-none"
                            >
                                <option value="preventivo">Preventivo (Aceite/Filtros)</option>
                                <option value="correctivo">Correctivo (Reparación)</option>
                                <option value="termo_king">Termo-King / Refrigeración</option>
                                <option value="llantas">Llantas / Alineación</option>
                                <option value="frenos">Frenos y Suspensión</option>
                                <option value="inspeccion">Inspección de Seguridad</option>
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                                Fecha Programada *
                            </label>
                            <input
                                type="date"
                                required
                                value={maintenanceForm.fecha_programada}
                                onChange={(e) => setMaintenanceForm(prev => ({ ...prev, fecha_programada: e.target.value }))}
                                className="w-full text-xs font-medium border border-slate-200 rounded-xl px-3 py-2 text-slate-800 outline-none"
                            />
                        </div>

                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                                Fecha Realizada
                            </label>
                            <input
                                type="date"
                                value={maintenanceForm.fecha_realizada}
                                onChange={(e) => setMaintenanceForm(prev => ({ ...prev, fecha_realizada: e.target.value }))}
                                className="w-full text-xs font-medium border border-slate-200 rounded-xl px-3 py-2 text-slate-800 outline-none"
                            />
                        </div>

                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                                Estado del Servicio
                            </label>
                            <select
                                value={maintenanceForm.estado}
                                onChange={(e) => setMaintenanceForm(prev => ({ ...prev, estado: e.target.value }))}
                                className="w-full text-xs font-bold border border-slate-200 rounded-xl px-3 py-2 text-slate-800 outline-none"
                            >
                                <option value="programado">Programado</option>
                                <option value="en_proceso">En Proceso (Taller)</option>
                                <option value="completado">Completado</option>
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                                Odómetro (Km)
                            </label>
                            <input
                                type="number"
                                value={maintenanceForm.odometro}
                                onChange={(e) => setMaintenanceForm(prev => ({ ...prev, odometro: e.target.value }))}
                                placeholder="Ej: 45200"
                                className="w-full text-xs font-medium border border-slate-200 rounded-xl px-3 py-2 text-slate-800 outline-none"
                            />
                        </div>

                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                                Taller o Proveedor
                            </label>
                            <input
                                type="text"
                                value={maintenanceForm.taller_proveedor}
                                onChange={(e) => setMaintenanceForm(prev => ({ ...prev, taller_proveedor: e.target.value }))}
                                placeholder="Ej: Taller Central Hino / Frío El Salvador"
                                className="w-full text-xs font-medium border border-slate-200 rounded-xl px-3 py-2 text-slate-800 outline-none"
                            />
                        </div>

                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                                Costo Total ($)
                            </label>
                            <MoneyInput
                                value={maintenanceForm.costo_total}
                                onChange={(val) => setMaintenanceForm(prev => ({ ...prev, costo_total: val }))}
                                placeholder="0.00"
                                className="w-full text-xs font-semibold border border-slate-200 rounded-xl px-3 py-2 text-slate-800 outline-none"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                            Descripción de Trabajos *
                        </label>
                        <textarea
                            required
                            rows="2"
                            value={maintenanceForm.descripcion}
                            onChange={(e) => setMaintenanceForm(prev => ({ ...prev, descripcion: e.target.value }))}
                            placeholder="Detalle de las tareas realizadas o requeridas..."
                            className="w-full text-xs border border-slate-200 rounded-xl p-2 text-slate-800 outline-none"
                        />
                    </div>

                    <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                        <button
                            type="button"
                            onClick={() => setMaintenanceModalOpen(false)}
                            className="text-xs font-semibold text-slate-600 px-4 py-2 hover:bg-slate-100 rounded-xl transition"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            className="text-xs font-bold bg-amber-600 text-white px-5 py-2.5 rounded-xl shadow hover:bg-amber-700 transition"
                        >
                            Guardar Registro
                        </button>
                    </div>
                </form>
            </Modal>

            {/* ========================================================================= */}
            {/* MODAL 5: ESCÁNER QR DTE & CONFIRMACIÓN DE ENTREGA */}
            {/* ========================================================================= */}
            <DteQrDeliveryScannerModal
                isOpen={deliveryScannerModalOpen}
                onClose={() => {
                    setDeliveryScannerModalOpen(false);
                    setSelectedStopToDeliver(null);
                }}
                stop={selectedStopToDeliver}
                onDeliveryConfirmed={() => {
                    if (routeDetail?.id) {
                        fetchRouteDetail(routeDetail.id);
                    }
                    fetchDriverRoutes();
                    fetchOrders();
                }}
            />
        </div>
    );
}
