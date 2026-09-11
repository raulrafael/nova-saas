import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'sonner';
import axios from 'axios';
import Modal from '../../components/ui/Modal';
import Money, { MoneyInput } from '../../components/ui/Money';
import {
    Calendar as CalendarIcon,
    ChevronLeft,
    ChevronRight,
    Plus,
    Sparkles,
    ShoppingBag,
    Search,
    RefreshCw,
    Clock,
    User,
    CheckCircle2,
    Circle,
    Trash2,
    Edit3,
    Play,
    Split,
    ShieldCheck,
    List,
    CalendarDays,
    X,
    Boxes,
    Wand2,
    CalendarCheck,
    ArrowRightLeft,
    CheckSquare,
    Check,
    AlertCircle,
    Building2,
    Truck
} from 'lucide-react';

import {
    getJulianDayInfo,
    generateJulianLotCode,
    convertGregorianLotToJulian,
    isJulianLotCode
} from '../../utils/julianDate';
import RawMaterialPlannerModal from '../../components/egg/RawMaterialPlannerModal';

const PRODUCT_PROFILES = [
    { id: 'Huevo Entero Pasteurizado', name: 'Huevo Entero Pasteurizado', defaultSolids: 23.5, color: 'indigo', desc: '83% rendimiento estándar' },
    { id: 'Huevo Formulado por Separación', name: 'Huevo Formulado por Separación (Yema + H2O)', defaultSolids: 22.5, color: 'emerald', desc: 'Venta de Clara + Yema con aditivo H2O' },
    { id: 'Huevo Entero Plus', name: 'Huevo Entero Plus', defaultSolids: 21.5, color: 'cyan', desc: 'Con agua 8% y ácido cítrico' },
    { id: 'Clara de Huevo Pasteurizada', name: 'Clara de Huevo Pasteurizada', defaultSolids: 11.5, color: 'teal', desc: '54% rendimiento, alta demanda' },
    { id: 'Yema Azucarada', name: 'Yema Azucarada (4% azúcar)', defaultSolids: 48.0, color: 'amber', desc: 'Para panificación y repostería' },
    { id: 'Yema Salada', name: 'Yema Salada (10% sal)', defaultSolids: 47.0, color: 'orange', desc: 'Para aderezos y mayonesa' },
    { id: 'Huevo con Leche', name: 'Huevo Entero con Leche', defaultSolids: 22.0, color: 'purple', desc: 'Institucional / servicios de vuelo' }
];

const FACTORY_ROLES = [
    'Quebrado y Carga',
    'Sanitización CIP',
    'Dosificación H2O / Mezcla',
    'Pasteurización HACCP',
    'Control de Calidad LAB-004',
    'Empaque y Cuarto Frío',
    'Supervisor de Turno'
];

const DEFAULT_PRESETS_BY_ROLE = {
    'Quebrado y Carga': 'Alinear y quebrar cajas de huevo blanco en cámara de quebrado.',
    'Sanitización CIP': 'Sanitizar pasteurizador con Ácido Peracético 1.5% a 78°C antes de iniciar.',
    'Dosificación H2O / Mezcla': 'Medir y dosificar agua desmineralizada H2O con ácido cítrico estabilizador.',
    'Pasteurización HACCP': 'Mantener régimen pasteurizador a 64.5°C por 210s monitoreando CCP-1.',
    'Control de Calidad LAB-004': 'Verificar refractómetro: Sólidos totales y pH antes de envasado.',
    'Empaque y Cuarto Frío': 'Alistar cubetas sanitizadas con liner alimentario y etiquetas de lote.'
};

const PRESENTATIONS = [
    'cubeta 30LB',
    'cubeta 32LB',
    'galon 8LB',
    'medio galon 4LB',
    'litro 2LB',
    'bolsa 20LB'
];

/**
 * Helper para buscar el acuerdo comercial activo de un cliente según el perfil o nombre de producto
 */
const findAgreementForProduct = (agreementsList, productType) => {
    if (!agreementsList || agreementsList.length === 0 || !productType) return null;

    const clean = (s) => (s || '')
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, ' ')
        .trim();

    const target = clean(productType);

    // 1. Coincidencia exacta de tipo de producto
    let match = agreementsList.find(a => clean(a.product_type) === target);
    if (match) return match;

    // 2. Coincidencias por palabras clave de perfiles
    if (target.includes('clara')) {
        match = agreementsList.find(a => clean(a.product_type).includes('clara') || clean(a.product_name).includes('clara'));
    } else if (target.includes('azucarada')) {
        match = agreementsList.find(a => clean(a.product_type).includes('azucar') || clean(a.product_name).includes('azucar'));
    } else if (target.includes('salada')) {
        match = agreementsList.find(a => clean(a.product_type).includes('salad') || clean(a.product_name).includes('salad'));
    } else if (target.includes('leche')) {
        match = agreementsList.find(a => clean(a.product_type).includes('leche') || clean(a.product_name).includes('leche'));
    } else if (target.includes('plus')) {
        match = agreementsList.find(a => clean(a.product_type).includes('plus') || clean(a.product_name).includes('plus'));
    } else if (target.includes('formulado') || target.includes('separacion')) {
        match = agreementsList.find(a => clean(a.product_type).includes('formulado') || clean(a.product_type).includes('separacion'));
        if (!match) {
            match = agreementsList.find(a => clean(a.product_type).includes('entero') && !clean(a.product_type).includes('plus'));
        }
    } else if (target.includes('entero')) {
        match = agreementsList.find(a => clean(a.product_type).includes('entero') && !clean(a.product_type).includes('plus'));
    }

    if (match) return match;

    // 3. Coincidencia por catálogo o descripción
    match = agreementsList.find(a => {
        const pName = clean(a.product_name);
        return pName && (pName.includes(target) || target.includes(pName));
    });
    if (match) return match;

    // 4. Si el cliente solo tiene 1 acuerdo comercial activo con precio registrado
    if (agreementsList.length === 1 && parseFloat(agreementsList[0].agreed_price_per_lb) > 0) {
        return agreementsList[0];
    }

    return null;
};

const ProductionCalendar = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const companyId = user?.company_id || 1;

    // View state: 'month', 'week', 'list'
    const [calendarView, setCalendarView] = useState('month');
    const [currentDate, setCurrentDate] = useState(new Date());

    // Data lists
    const [productions, setProductions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [factoryUsers, setFactoryUsers] = useState([]);
    const [suggestionsData, setSuggestionsData] = useState(null);
    const [loadingSuggestions, setLoadingSuggestions] = useState(false);
    const [customerOrders, setCustomerOrders] = useState([]);

    // Filters
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('todos');
    const [profileFilter, setProfileFilter] = useState('todos');

    // Modals
    const [isFormModalOpen, setIsFormModalOpen] = useState(false);
    const [isSuggestionsDrawerOpen, setIsSuggestionsDrawerOpen] = useState(false);
    const [isOrdersModalOpen, setIsOrdersModalOpen] = useState(false);
    const [isPlannerModalOpen, setIsPlannerModalOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Sugerencia Mensual IA & Planificador MP
    const [suggestionsTab, setSuggestionsTab] = useState('monthly'); // 'monthly' | 'tactical'
    const [monthlyPlanData, setMonthlyPlanData] = useState(null);
    const [loadingMonthlyPlan, setLoadingMonthlyPlan] = useState(false);
    const [applyingPlan, setApplyingPlan] = useState(false);
    const [selectedPlanRuns, setSelectedPlanRuns] = useState([]);
    const [julianFormat, setJulianFormat] = useState('standard'); // 'standard' (LOTE-YYJJJ-NN) | 'andelsa' (NN - JJJ - YY)

    // Drag and Drop state
    const [draggedItem, setDraggedItem] = useState(null);
    const [dragOverDate, setDragOverDate] = useState(null);

    // Form state
    const [formData, setFormData] = useState({
        id: null,
        production_date: new Date().toISOString().split('T')[0],
        start_time: '06:00',
        end_time: '14:00',
        lot_code: '',
        product_profile: 'Huevo Entero Pasteurizado',
        presentation: 'cubeta 30LB',
        target_quantity_lbs: 12000,
        target_solids_pct: 23.5,
        status: 'programado',
        priority: 'media',
        mix_formula_json: {
            raw_egg_boxes: 332,
            raw_liquid_lbs: 12000,
            clara_separated_pct: 0,
            clara_produced_lbs: 0,
            yema_coproduct_lbs: 0,
            yema_reutilized_lbs: 0,
            water_h2o_lbs: 0,
            water_bottles: 0,
            citric_acid_lbs: '0.00',
            sugar_lbs: '0.00',
            salt_lbs: '0.00',
            milk_powder_lbs: '0.00',
            notes: ''
        },
        assigned_operator_id: '',
        assigned_operator_name: '',
        notes: '',
        tasks: []
    });

    // Temporary task state inside form
    const [newTaskRole, setNewTaskRole] = useState(FACTORY_ROLES[0]);
    const [newTaskUser, setNewTaskUser] = useState('');
    const [newTaskDesc, setNewTaskDesc] = useState(DEFAULT_PRESETS_BY_ROLE[FACTORY_ROLES[0]] || '');

    // Customer order form & CRM Integration
    const [orderForm, setOrderForm] = useState({
        customer_id: '',
        customer_name: '',
        order_number: '',
        product_type: 'Huevo Entero Pasteurizado',
        presentation: 'cubeta 30LB',
        quantity_lbs: '',
        required_delivery_date: new Date().toISOString().split('T')[0],
        price_per_lb: '',
        notes: ''
    });
    const [customerSearchInput, setCustomerSearchInput] = useState('');
    const [customerSearchResults, setCustomerSearchResults] = useState([]);
    const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
    const [loadingCustomers, setLoadingCustomers] = useState(false);
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [customerAgreements, setCustomerAgreements] = useState([]);
    const [loadingAgreements, setLoadingAgreements] = useState(false);
    const [agreedPriceNotice, setAgreedPriceNotice] = useState(null);

    // Fetch primary data
    const fetchProductions = async () => {
        setLoading(true);
        try {
            const res = await axios.get('/api/egg-industrial/calendar');
            setProductions(res.data || []);
        } catch (error) {
            console.error('Error cargando producciones programadas:', error);
            toast.error('Error al cargar calendario de producción.');
        } finally {
            setLoading(false);
        }
    };

    const fetchFactoryUsers = async () => {
        try {
            const res = await axios.get('/api/egg-industrial/factory-users');
            setFactoryUsers(res.data || []);
        } catch (error) {
            console.error('Error cargando usuarios de planta:', error);
        }
    };

    const fetchSuggestions = async () => {
        setLoadingSuggestions(true);
        try {
            const res = await axios.get('/api/egg-industrial/calendar/suggestions');
            setSuggestionsData(res.data || null);
        } catch (error) {
            console.error('Error cargando sugerencias inteligentes:', error);
        } finally {
            setLoadingSuggestions(false);
        }
    };

    const fetchOrders = async () => {
        try {
            const res = await axios.get('/api/egg-industrial/orders');
            setCustomerOrders(res.data || []);
        } catch (error) {
            console.error('Error cargando pedidos de clientes:', error);
        }
    };

    const fetchMonthlyPlan = async (targetD = currentDate) => {
        setLoadingMonthlyPlan(true);
        try {
            const targetYear = targetD.getFullYear();
            const targetMonth = targetD.getMonth() + 1;
            const res = await axios.get('/api/egg-industrial/calendar/monthly-suggestions', {
                params: { year: targetYear, month: targetMonth }
            });
            setMonthlyPlanData(res.data || null);
            // Pre-seleccionar todos los que no estén ya programados
            const unscheduled = (res.data?.monthly_plan || []).filter(p => !p.already_scheduled);
            setSelectedPlanRuns(unscheduled);
        } catch (error) {
            console.error('Error cargando plan mensual de producción:', error);
        } finally {
            setLoadingMonthlyPlan(false);
        }
    };

    const handleConvertLotToJulian = async (prodId) => {
        try {
            const res = await axios.post(`/api/egg-industrial/calendar/${prodId}/convert-julian`);
            toast.success(`Lote actualizado a formato juliano: ${res.data.new_lot_code}`);
            fetchProductions();
        } catch (error) {
            console.error('Error convirtiendo lote a juliano:', error);
            toast.error('Error al convertir lote a formato juliano.');
        }
    };

    const handleApplyMonthlyPlan = async () => {
        if (!selectedPlanRuns || selectedPlanRuns.length === 0) {
            toast.warning('No hay producciones seleccionadas para programar.');
            return;
        }
        setApplyingPlan(true);
        try {
            const res = await axios.post('/api/egg-industrial/calendar/apply-monthly-plan', {
                productions: selectedPlanRuns
            });
            toast.success(res.data.message || 'Plan mensual aplicado exitosamente al calendario.');
            setIsSuggestionsDrawerOpen(false);
            fetchProductions();
            fetchSuggestions();
            fetchMonthlyPlan(currentDate);
        } catch (error) {
            console.error('Error aplicando plan mensual:', error);
            toast.error(error.response?.data?.message || 'Error al aplicar plan mensual.');
        } finally {
            setApplyingPlan(false);
        }
    };

    useEffect(() => {
        fetchProductions();
        fetchFactoryUsers();
        fetchSuggestions();
        fetchOrders();
        fetchMonthlyPlan(currentDate);
    }, [companyId, currentDate.getMonth(), currentDate.getFullYear()]);

    // Recalculate BOM mix formula based on product profile and target lbs
    const recalculateMixFormula = (profileName, targetLbs) => {
        const qty = parseFloat(targetLbs) || 12000;
        const profLower = (profileName || '').toLowerCase();

        let rawLiquid = qty;
        let boxes = Math.round(qty / 36.1);
        let claraSepPct = 0;
        let claraLbs = 0;
        let yemaCoproduct = 0;
        let yemaReutilized = 0;
        let waterLbs = 0;
        let citricAcid = '0.00';
        let sugarLbs = '0.00';
        let saltLbs = '0.00';
        let milkLbs = '0.00';
        let solids = 23.5;
        let notes = '';

        if (profLower.includes('separaci') || profLower.includes('formulado')) {
            // Caso reformulación con H2O por separación de clara
            // 1 lb yema pura (50% sólidos) + 1.22 lbs H2O -> 2.22 lbs formulado
            solids = 22.5;
            claraSepPct = 100;
            const yemaNeeded = qty / 2.22;
            rawLiquid = Math.round(yemaNeeded / 0.308); // Yema es 30.8% del líquido quebrado
            boxes = Math.round(rawLiquid / 36.1);
            claraLbs = Math.round(rawLiquid * 0.5395); // 53.95% rinde clara
            yemaCoproduct = Math.round(yemaNeeded);
            yemaReutilized = yemaCoproduct;
            waterLbs = Math.round(qty - yemaNeeded);
            citricAcid = (qty * 0.0015).toFixed(2);
            notes = `Separar ${claraLbs.toLocaleString()} Lbs de clara pura para empaque. Reincorporar ${yemaReutilized.toLocaleString()} Lbs de yema coproducto con ${waterLbs.toLocaleString()} Lbs de H2O purificada y ${citricAcid} Lbs de ácido cítrico.`;
        } else if (profLower.includes('clara')) {
            solids = 11.5;
            rawLiquid = Math.round(qty / 0.5395);
            boxes = Math.round(rawLiquid / 36.1);
            claraSepPct = 100;
            claraLbs = qty;
            yemaCoproduct = Math.round(rawLiquid * 0.308);
            notes = `Corrida de separación de clara. Genera ${yemaCoproduct.toLocaleString()} Lbs de yema coproducto excedente.`;
        } else if (profLower.includes('plus')) {
            solids = 21.5;
            waterLbs = Math.round(qty * 0.08);
            rawLiquid = qty - waterLbs;
            boxes = Math.round(rawLiquid / 36.1);
            citricAcid = (qty * 0.0012).toFixed(2);
            notes = `Adicionar ${waterLbs.toLocaleString()} Lbs de agua purificada (8%) y ${citricAcid} Lbs de ácido cítrico sobre ${rawLiquid.toLocaleString()} Lbs de huevo líquido base.`;
        } else if (profLower.includes('azucar')) {
            solids = 48.0;
            sugarLbs = (qty * 0.04).toFixed(2);
            rawLiquid = qty - parseFloat(sugarLbs);
            boxes = Math.round((rawLiquid / 0.308) / 36.1);
            notes = `Yema azucarada al 4%: mezclar ${rawLiquid.toLocaleString()} Lbs de yema con ${sugarLbs} Lbs de azúcar refinada.`;
        } else if (profLower.includes('salada')) {
            solids = 47.0;
            saltLbs = (qty * 0.10).toFixed(2);
            rawLiquid = qty - parseFloat(saltLbs);
            boxes = Math.round((rawLiquid / 0.308) / 36.1);
            notes = `Yema salada al 10%: mezclar ${rawLiquid.toLocaleString()} Lbs de yema con ${saltLbs} Lbs de sal no yodada.`;
        } else if (profLower.includes('leche')) {
            solids = 22.0;
            milkLbs = (qty * 0.06).toFixed(2);
            waterLbs = Math.round(qty * 0.04);
            rawLiquid = qty - parseFloat(milkLbs) - waterLbs;
            boxes = Math.round(rawLiquid / 36.1);
            notes = `Huevo con leche: dosificar ${milkLbs} Lbs de leche en polvo y ${waterLbs} Lbs de agua purificada.`;
        } else {
            // Huevo entero estándar
            solids = 23.5;
            rawLiquid = qty;
            boxes = Math.round(qty / 36.1);
            notes = `Huevo entero pasteurizado estándar al 83% de rendimiento (332 cajas aprox por batch de 12,000 Lbs).`;
        }

        const waterBottles = waterLbs > 0 ? Math.ceil(waterLbs / 41.8) : 0;

        return {
            raw_egg_boxes: boxes,
            raw_liquid_lbs: rawLiquid,
            clara_separated_pct: claraSepPct,
            clara_produced_lbs: claraLbs,
            yema_coproduct_lbs: yemaCoproduct,
            yema_reutilized_lbs: yemaReutilized,
            water_h2o_lbs: waterLbs,
            water_bottles: waterBottles,
            citric_acid_lbs: citricAcid,
            sugar_lbs: sugarLbs,
            salt_lbs: saltLbs,
            milk_powder_lbs: milkLbs,
            target_solids_pct: solids,
            notes
        };
    };

    // Open modal to create new production
    const handleOpenCreateModal = (suggestedDate = null, defaultRunData = null) => {
        const targetDate = suggestedDate || new Date().toISOString().split('T')[0];
        const julianLot = generateJulianLotCode(targetDate, 1, julianFormat);

        if (defaultRunData) {
            setFormData({
                id: null,
                production_date: defaultRunData.production_date || targetDate,
                start_time: defaultRunData.start_time || '06:00',
                end_time: defaultRunData.end_time || '14:00',
                lot_code: defaultRunData.lot_code || julianLot,
                product_profile: defaultRunData.product_profile || 'Huevo Entero Pasteurizado',
                presentation: defaultRunData.presentation || 'cubeta 30LB',
                target_quantity_lbs: defaultRunData.target_quantity_lbs || 12000,
                target_solids_pct: defaultRunData.target_solids_pct || 22.5,
                status: 'programado',
                priority: defaultRunData.priority || 'alta',
                mix_formula_json: defaultRunData.mix_formula_json || recalculateMixFormula(defaultRunData.product_profile, defaultRunData.target_quantity_lbs),
                assigned_operator_id: '',
                assigned_operator_name: '',
                notes: defaultRunData.notes || '',
                tasks: (defaultRunData.tasks || []).map(t => ({
                    factory_role: t.factory_role || 'General',
                    user_name: 'Operario de Planta',
                    task_description: t.task_description || '',
                    checklist_status: 'pendiente'
                }))
            });
        } else {
            const defaultMix = recalculateMixFormula('Huevo Entero Pasteurizado', 12000);
            setFormData({
                id: null,
                production_date: targetDate,
                start_time: '06:00',
                end_time: '14:00',
                lot_code: julianLot,
                product_profile: 'Huevo Entero Pasteurizado',
                presentation: 'cubeta 30LB',
                target_quantity_lbs: 12000,
                target_solids_pct: 23.5,
                status: 'programado',
                priority: 'media',
                mix_formula_json: defaultMix,
                assigned_operator_id: '',
                assigned_operator_name: '',
                notes: '',
                tasks: [
                    { factory_role: 'Sanitización CIP', user_name: 'Sanitizador', task_description: 'Verificar sanitización CIP del pasteurizador a 78°C', checklist_status: 'pendiente' },
                    { factory_role: 'Quebrado y Carga', user_name: 'Operador Quebrado', task_description: 'Cargar tolva con 332 cajas de huevo blanco', checklist_status: 'pendiente' },
                    { factory_role: 'Pasteurización HACCP', user_name: 'Operador Pasteurizador', task_description: 'Pasteurizar a 64.5°C por 210s CCP-1', checklist_status: 'pendiente' },
                    { factory_role: 'Control de Calidad LAB-004', user_name: 'Analista LAB', task_description: 'Medir Brix 23.5% y pH de línea', checklist_status: 'pendiente' },
                    { factory_role: 'Empaque y Cuarto Frío', user_name: 'Empacador', task_description: 'Alistar 400 cubetas de 30 Lb sanitizadas con liner', checklist_status: 'pendiente' }
                ]
            });
        }

        setIsFormModalOpen(true);
    };

    // Open modal to edit existing production
    const handleOpenEditModal = (prod) => {
        setFormData({
            id: prod.id,
            production_date: prod.production_date ? new Date(prod.production_date).toISOString().split('T')[0] : '',
            start_time: prod.start_time ? prod.start_time.slice(0, 5) : '06:00',
            end_time: prod.end_time ? prod.end_time.slice(0, 5) : '14:00',
            lot_code: prod.lot_code || '',
            product_profile: prod.product_profile || 'Huevo Entero Pasteurizado',
            presentation: prod.presentation || 'cubeta 30LB',
            target_quantity_lbs: prod.target_quantity_lbs || 12000,
            target_solids_pct: prod.target_solids_pct || 21.5,
            status: prod.status || 'programado',
            priority: prod.priority || 'media',
            mix_formula_json: prod.mix_formula_json || {},
            assigned_operator_id: prod.assigned_operator_id || '',
            assigned_operator_name: prod.assigned_operator_name || '',
            notes: prod.notes || '',
            tasks: prod.tasks || []
        });
        setIsFormModalOpen(true);
    };

    // Handle Profile Change in Form
    const handleProfileChange = (newProfile) => {
        const newMix = recalculateMixFormula(newProfile, formData.target_quantity_lbs);
        setFormData(prev => ({
            ...prev,
            product_profile: newProfile,
            target_solids_pct: newMix.target_solids_pct,
            mix_formula_json: newMix
        }));
    };

    // Handle Target Quantity Change in Form
    const handleQuantityChange = (newQty) => {
        const val = parseFloat(newQty) || 0;
        const newMix = recalculateMixFormula(formData.product_profile, val);
        setFormData(prev => ({
            ...prev,
            target_quantity_lbs: val,
            mix_formula_json: newMix
        }));
    };

    // Add Task to local checklist
    const handleAddTask = () => {
        if (!newTaskDesc || newTaskDesc.trim() === '') {
            return toast.warning('Escriba la descripción de la tarea.');
        }
        const userObj = factoryUsers.find(u => String(u.id) === String(newTaskUser));
        const taskItem = {
            user_id: userObj ? userObj.id : null,
            user_name: userObj ? userObj.nombre : 'Operario de Planta',
            factory_role: newTaskRole,
            task_description: newTaskDesc.trim(),
            checklist_status: 'pendiente'
        };
        setFormData(prev => ({
            ...prev,
            tasks: [...prev.tasks, taskItem]
        }));
        setNewTaskDesc('');
    };

    // Remove Task from local checklist
    const handleRemoveTask = (idx) => {
        setFormData(prev => ({
            ...prev,
            tasks: prev.tasks.filter((_, i) => i !== idx)
        }));
    };

    // Save Production (Create or Update)
    const handleSaveProduction = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            if (formData.id) {
                await axios.put(`/api/egg-industrial/calendar/${formData.id}`, formData);
                toast.success('Producción actualizada exitosamente.');
            } else {
                await axios.post('/api/egg-industrial/calendar', formData);
                toast.success('Producción programada exitosamente.');
            }
            setIsFormModalOpen(false);
            fetchProductions();
        } catch (error) {
            console.error('Error al guardar producción:', error);
            toast.error(error.response?.data?.message || 'Error al guardar producción.');
        } finally {
            setIsSubmitting(false);
        }
    };

    // Delete Production
    const handleDeleteProduction = async (id, lotCode) => {
        if (!window.confirm(`¿Está seguro de eliminar la producción programada ${lotCode}?`)) return;
        try {
            await axios.delete(`/api/egg-industrial/calendar/${id}`);
            toast.success(`Producción ${lotCode} eliminada.`);
            fetchProductions();
        } catch (error) {
            console.error('Error al eliminar:', error);
            toast.error(error.response?.data?.message || 'Error al eliminar producción.');
        }
    };

    // Start Batch in Plant
    const handleStartBatchInPlant = async (id, lotCode) => {
        if (!window.confirm(`¿Desea iniciar la ejecución real del lote ${lotCode} en planta de producción?`)) return;
        try {
            await axios.post(`/api/egg-industrial/calendar/${id}/start-batch`);
            toast.success(`Lote ${lotCode} iniciado en planta.`);
            fetchProductions();
            navigate('/industrial/produccion');
        } catch (error) {
            console.error('Error al iniciar lote:', error);
            toast.error(error.response?.data?.message || 'Error al iniciar lote en planta.');
        }
    };

    // Toggle Task Status directly from Calendar / View
    const handleToggleTask = async (taskId) => {
        try {
            await axios.patch(`/api/egg-industrial/calendar/tasks/${taskId}/toggle`);
            setProductions(prev => prev.map(p => ({
                ...p,
                tasks: p.tasks.map(t => {
                    if (t.id === taskId) {
                        const nextStatus = t.checklist_status === 'completado' ? 'pendiente' : 'completado';
                        return { ...t, checklist_status: nextStatus };
                    }
                    return t;
                })
            })));
            toast.success('Estado de tarea actualizado.');
        } catch (error) {
            console.error('Error al alternar tarea:', error);
            toast.error('Error al actualizar tarea.');
        }
    };

    // --- DRAG AND DROP HANDLERS ---
    const handleDragStart = (e, prod) => {
        setDraggedItem(prod);
        e.dataTransfer.setData('text/plain', String(prod.id));
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e, dateStr) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dragOverDate !== dateStr) {
            setDragOverDate(dateStr);
        }
    };

    const handleDragLeave = () => {
        setDragOverDate(null);
    };

    const handleDrop = async (e, targetDateStr) => {
        e.preventDefault();
        setDragOverDate(null);
        if (!draggedItem) return;

        const originalDate = draggedItem.production_date ? new Date(draggedItem.production_date).toISOString().split('T')[0] : '';
        if (originalDate === targetDateStr) {
            setDraggedItem(null);
            return;
        }

        // Optimistic UI update
        const updatedItem = { ...draggedItem, production_date: targetDateStr };
        setProductions(prev => prev.map(p => p.id === draggedItem.id ? updatedItem : p));

        try {
            await axios.patch(`/api/egg-industrial/calendar/${draggedItem.id}/move`, {
                production_date: targetDateStr
            });
            toast.success(`Lote ${draggedItem.lot_code} reprogramado al ${targetDateStr}`);
        } catch (error) {
            console.error('Error al mover producción:', error);
            toast.error('Error al reprogramar la fecha de producción.');
            fetchProductions(); // Rollback
        } finally {
            setDraggedItem(null);
        }
    };

    // Customer Orders & CRM Autocomplete Handlers
    const searchCustomersList = async (query = '') => {
        setLoadingCustomers(true);
        try {
            const res = await axios.get('/api/customers', {
                params: {
                    search: query || undefined,
                    limit: 15
                }
            });
            const list = res.data?.data || (Array.isArray(res.data) ? res.data : []);
            setCustomerSearchResults(list);
        } catch (error) {
            console.error('Error buscando clientes:', error);
        } finally {
            setLoadingCustomers(false);
        }
    };

    useEffect(() => {
        if (isOrdersModalOpen) {
            searchCustomersList('');
        } else {
            setShowCustomerDropdown(false);
        }
    }, [isOrdersModalOpen]);

    const handleCustomerInputChange = (e) => {
        const val = e.target.value;
        setCustomerSearchInput(val);
        setShowCustomerDropdown(true);

        if (selectedCustomer && val !== selectedCustomer.nombre) {
            setSelectedCustomer(null);
            setCustomerAgreements([]);
            setAgreedPriceNotice(null);
            setOrderForm(prev => ({ ...prev, customer_id: '', customer_name: val, price_per_lb: '' }));
        } else {
            setOrderForm(prev => ({ ...prev, customer_name: val }));
        }

        searchCustomersList(val);
    };

    const handleSelectCustomer = async (cust) => {
        setSelectedCustomer(cust);
        setCustomerSearchInput(cust.nombre);
        setShowCustomerDropdown(false);
        setOrderForm(prev => ({
            ...prev,
            customer_id: cust.id,
            customer_name: cust.nombre
        }));

        setLoadingAgreements(true);
        try {
            const res = await axios.get(`/api/crm/customer-agreements/active-by-customer/${cust.id}`);
            const agreements = res.data || [];
            setCustomerAgreements(agreements);

            const match = findAgreementForProduct(agreements, orderForm.product_type);
            if (match && parseFloat(match.agreed_price_per_lb) > 0) {
                const price = match.agreed_price_per_lb;
                setOrderForm(prev => ({ ...prev, customer_id: cust.id, customer_name: cust.nombre, price_per_lb: price }));
                setAgreedPriceNotice({
                    type: 'crm',
                    price: price,
                    product: match.product_type || match.product_name,
                    label: `Precio pactado en CRM ($${parseFloat(price).toFixed(2)}/lb) jalado automáticamente`
                });
                toast.success(`Precio acordado de $${parseFloat(price).toFixed(2)}/lb jalado automáticamente desde CRM.`);
            } else {
                setOrderForm(prev => ({ ...prev, customer_id: cust.id, customer_name: cust.nombre, price_per_lb: '' }));
                setAgreedPriceNotice({
                    type: 'none',
                    label: agreements.length > 0
                        ? `Cliente con acuerdos para otros productos, sin precio pactado para ${orderForm.product_type}`
                        : 'Cliente registrado sin acuerdos activos de precio en CRM'
                });
            }
        } catch (error) {
            console.error('Error al cargar acuerdos del cliente:', error);
            setCustomerAgreements([]);
        } finally {
            setLoadingAgreements(false);
        }
    };

    const handleProductTypeChange = (newProductType) => {
        setOrderForm(prev => ({ ...prev, product_type: newProductType }));

        if (selectedCustomer && customerAgreements.length > 0) {
            const match = findAgreementForProduct(customerAgreements, newProductType);
            if (match && parseFloat(match.agreed_price_per_lb) > 0) {
                const price = match.agreed_price_per_lb;
                setOrderForm(prev => ({ ...prev, product_type: newProductType, price_per_lb: price }));
                setAgreedPriceNotice({
                    type: 'crm',
                    price: price,
                    product: match.product_type || match.product_name,
                    label: `Precio pactado en CRM ($${parseFloat(price).toFixed(2)}/lb) jalado automáticamente`
                });
                toast.info(`Precio acordado aplicado para ${newProductType}: $${parseFloat(price).toFixed(2)}/lb`);
            } else {
                setOrderForm(prev => ({ ...prev, product_type: newProductType, price_per_lb: '' }));
                setAgreedPriceNotice({
                    type: 'none',
                    label: `Sin precio pactado en CRM para ${newProductType}`
                });
            }
        }
    };

    const handleSaveOrder = async (e) => {
        e.preventDefault();

        let custId = orderForm.customer_id;
        let custName = (orderForm.customer_name || customerSearchInput || '').trim();

        if (!custId) {
            const exact = customerSearchResults.find(c =>
                c.nombre.toLowerCase().trim() === custName.toLowerCase().trim() ||
                (c.nombre_comercial && c.nombre_comercial.toLowerCase().trim() === custName.toLowerCase().trim())
            );
            if (exact) {
                custId = exact.id;
                custName = exact.nombre;
            } else {
                toast.error('El cliente debe coincidir con un cliente registrado en el catálogo.');
                setShowCustomerDropdown(true);
                return;
            }
        }

        try {
            const payload = {
                ...orderForm,
                customer_id: custId,
                customer_name: custName
            };
            const res = await axios.post('/api/egg-industrial/orders', payload);
            toast.success(res.data.message || 'Pedido de cliente registrado exitosamente.');
            setOrderForm({
                customer_id: '',
                customer_name: '',
                order_number: '',
                product_type: 'Huevo Entero Pasteurizado',
                presentation: 'cubeta 30LB',
                quantity_lbs: '',
                required_delivery_date: new Date().toISOString().split('T')[0],
                price_per_lb: '',
                notes: ''
            });
            setSelectedCustomer(null);
            setCustomerSearchInput('');
            setCustomerAgreements([]);
            setAgreedPriceNotice(null);
            fetchOrders();
            fetchSuggestions();
        } catch (error) {
            console.error('Error al guardar pedido:', error);
            toast.error(error.response?.data?.message || 'Error al registrar pedido.');
        }
    };

    const handleDeleteOrder = async (id) => {
        if (!window.confirm('¿Eliminar este pedido de cliente?')) return;
        try {
            await axios.delete(`/api/egg-industrial/orders/${id}`);
            toast.success('Pedido eliminado.');
            fetchOrders();
            fetchSuggestions();
        } catch (error) {
            console.error('Error al eliminar pedido:', error);
            toast.error('Error al eliminar pedido.');
        }
    };

    // Filtered Productions
    const filteredProductions = useMemo(() => {
        return productions.filter(p => {
            const matchesSearch = !searchTerm ||
                (p.lot_code && p.lot_code.toLowerCase().includes(searchTerm.toLowerCase())) ||
                (p.product_profile && p.product_profile.toLowerCase().includes(searchTerm.toLowerCase())) ||
                (p.assigned_operator_name && p.assigned_operator_name.toLowerCase().includes(searchTerm.toLowerCase()));

            const matchesStatus = statusFilter === 'todos' || p.status === statusFilter;
            const matchesProfile = profileFilter === 'todos' || p.product_profile === profileFilter;

            return matchesSearch && matchesStatus && matchesProfile;
        });
    }, [productions, searchTerm, statusFilter, profileFilter]);

    // Calendar Calculations for Monthly Grid
    const calendarMonthDays = useMemo(() => {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();

        const firstDayOfMonth = new Date(year, month, 1);
        const lastDayOfMonth = new Date(year, month + 1, 0);

        // Day of week: 0 is Sun, 1 is Mon. Adjust so week starts on Monday (0=Mon, 6=Sun)
        let startingDayOfWeek = firstDayOfMonth.getDay() - 1;
        if (startingDayOfWeek === -1) startingDayOfWeek = 6;

        const totalDaysInMonth = lastDayOfMonth.getDate();
        const days = [];

        // Previous month days padding
        const prevMonthLastDay = new Date(year, month, 0).getDate();
        for (let i = startingDayOfWeek - 1; i >= 0; i--) {
            const d = new Date(year, month - 1, prevMonthLastDay - i);
            days.push({
                date: d,
                dateStr: d.toISOString().split('T')[0],
                isCurrentMonth: false,
                dayNumber: d.getDate()
            });
        }

        // Current month days
        for (let i = 1; i <= totalDaysInMonth; i++) {
            const d = new Date(year, month, i);
            days.push({
                date: d,
                dateStr: d.toISOString().split('T')[0],
                isCurrentMonth: true,
                dayNumber: i
            });
        }

        // Next month days padding to complete 35 or 42 grid cells
        const remainingCells = 42 - days.length;
        for (let i = 1; i <= remainingCells; i++) {
            const d = new Date(year, month + 1, i);
            days.push({
                date: d,
                dateStr: d.toISOString().split('T')[0],
                isCurrentMonth: false,
                dayNumber: i
            });
        }

        return days;
    }, [currentDate]);

    // Helper to get productions for a specific date
    const getProductionsForDate = (dateStr) => {
        return filteredProductions.filter(p => {
            if (!p.production_date) return false;
            const pDate = new Date(p.production_date).toISOString().split('T')[0];
            return pDate === dateStr;
        });
    };

    // Helper for profile badge colors
    const getProfileBadgeStyle = (profile) => {
        const pLower = (profile || '').toLowerCase();
        if (pLower.includes('separaci') || pLower.includes('formulado')) {
            return {
                bg: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
                card: 'border-l-4 border-l-emerald-500 bg-emerald-50/50 hover:bg-emerald-50'
            };
        }
        if (pLower.includes('clara')) {
            return {
                bg: 'bg-teal-500/10 text-teal-600 border-teal-500/20',
                card: 'border-l-4 border-l-teal-500 bg-teal-50/50 hover:bg-teal-50'
            };
        }
        if (pLower.includes('yema')) {
            return {
                bg: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
                card: 'border-l-4 border-l-amber-500 bg-amber-50/50 hover:bg-amber-50'
            };
        }
        if (pLower.includes('leche')) {
            return {
                bg: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
                card: 'border-l-4 border-l-purple-500 bg-purple-50/50 hover:bg-purple-50'
            };
        }
        if (pLower.includes('plus')) {
            return {
                bg: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20',
                card: 'border-l-4 border-l-cyan-500 bg-cyan-50/50 hover:bg-cyan-50'
            };
        }
        return {
            bg: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20',
            card: 'border-l-4 border-l-indigo-500 bg-indigo-50/40 hover:bg-indigo-50'
        };
    };

    const monthNames = [
        'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];

    const todayStr = new Date().toISOString().split('T')[0];

    // Summary KPIs
    const totalScheduledLbs = useMemo(() => {
        return filteredProductions.reduce((sum, p) => sum + (parseFloat(p.target_quantity_lbs) || 0), 0);
    }, [filteredProductions]);

    const totalTasksCount = useMemo(() => {
        let done = 0;
        let total = 0;
        filteredProductions.forEach(p => {
            (p.tasks || []).forEach(t => {
                total++;
                if (t.checklist_status === 'completado') done++;
            });
        });
        return { done, total };
    }, [filteredProductions]);

    return (
        <div className="space-y-4 sm:space-y-6 pb-12">
            {/* CABECERA PRINCIPAL CON ESTÉTICA PREMIUM */}
            <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-6 shadow-sm">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2.5">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center text-white shadow-md shadow-indigo-200">
                                <CalendarIcon className="w-5 h-5" />
                            </div>
                            <div>
                                <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                                    Calendario de Producción
                                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-200/80">
                                        ANDELSA Planta
                                    </span>
                                </h1>
                                <p className="text-xs sm:text-[13px] text-slate-500 font-medium">
                                    Programación interactiva de lotes, formulaciones con balance de coproductos (H2O) y roles de fábrica.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        {/* Botón Sugerencias Inteligentes */}
                        <button
                            type="button"
                            onClick={() => setIsSuggestionsDrawerOpen(true)}
                            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-xs font-bold shadow-md shadow-emerald-200 hover:brightness-105 active:scale-95 transition-all"
                        >
                            <Sparkles className="w-4 h-4 text-emerald-200" />
                            <span>Sugerencias IA</span>
                            {suggestionsData?.suggestions?.length > 0 && (
                                <span className="px-1.5 py-0.2 bg-white text-emerald-700 rounded-full text-[10px] font-black">
                                    {suggestionsData.suggestions.length}
                                </span>
                            )}
                        </button>

                        {/* Botón Pedidos de Clientes */}
                        <button
                            type="button"
                            onClick={() => setIsOrdersModalOpen(true)}
                            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200/80 text-slate-700 text-xs font-bold transition-all"
                        >
                            <ShoppingBag className="w-4 h-4 text-slate-500" />
                            <span className="hidden sm:inline">Pedidos Clientes</span>
                            <span className="sm:hidden">Pedidos</span>
                            {customerOrders.length > 0 && (
                                <span className="px-1.5 py-0.2 bg-slate-300 text-slate-800 rounded-full text-[10px] font-black">
                                    {customerOrders.length}
                                </span>
                            )}
                        </button>

                        {/* Botón Despachos y Rutas */}
                        <button
                            type="button"
                            onClick={() => navigate('/industrial/despachos')}
                            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-slate-800 text-white text-xs font-bold shadow-md hover:brightness-110 active:scale-95 transition-all"
                        >
                            <Truck className="w-4 h-4 text-indigo-200" />
                            <span className="hidden sm:inline">Despachos y Rutas</span>
                            <span className="sm:hidden">Despachos</span>
                        </button>


                        {/* Botón Planificador de Materia Prima (MRP) */}
                        <button
                            type="button"
                            onClick={() => setIsPlannerModalOpen(true)}
                            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white text-xs font-bold shadow-md shadow-amber-200 hover:brightness-105 active:scale-95 transition-all"
                        >
                            <Boxes className="w-4 h-4 text-amber-100" />
                            <span className="hidden sm:inline">Planificador Materia Prima</span>
                            <span className="sm:hidden">Planificador MP</span>
                        </button>

                        {/* Botón Nueva Producción */}
                        <button
                            type="button"
                            onClick={() => handleOpenCreateModal()}
                            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md shadow-indigo-200 active:scale-95 transition-all"
                        >
                            <Plus className="w-4 h-4" />
                            <span>Nueva Producción</span>
                        </button>
                    </div>
                </div>

                {/* TARJETAS KPI DE RESUMEN OPERATIVO */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-4 border-t border-slate-100">
                    <div className="bg-slate-50/80 rounded-xl p-3 border border-slate-200/60">
                        <span className="text-[10px] font-bold text-slate-500 uppercase block tracking-wider">Lotes Programados</span>
                        <div className="flex items-baseline gap-1.5 mt-0.5">
                            <span className="text-xl font-extrabold text-slate-900">{filteredProductions.length}</span>
                            <span className="text-[11px] text-slate-500 font-medium">corridas</span>
                        </div>
                    </div>

                    <div className="bg-slate-50/80 rounded-xl p-3 border border-slate-200/60">
                        <span className="text-[10px] font-bold text-slate-500 uppercase block tracking-wider">Volumen Estimado</span>
                        <div className="flex items-baseline gap-1 mt-0.5">
                            <span className="text-xl font-extrabold text-indigo-600">{totalScheduledLbs.toLocaleString()}</span>
                            <span className="text-[11px] text-slate-500 font-medium">Lbs</span>
                        </div>
                    </div>

                    <div className="bg-slate-50/80 rounded-xl p-3 border border-slate-200/60">
                        <span className="text-[10px] font-bold text-slate-500 uppercase block tracking-wider">Preparación / Roles</span>
                        <div className="flex items-baseline gap-1 mt-0.5">
                            <span className="text-xl font-extrabold text-emerald-600">{totalTasksCount.done}</span>
                            <span className="text-xs text-slate-500">/ {totalTasksCount.total} listas</span>
                        </div>
                    </div>

                    <div className="bg-slate-50/80 rounded-xl p-3 border border-slate-200/60">
                        <span className="text-[10px] font-bold text-slate-500 uppercase block tracking-wider">Demanda Pendiente</span>
                        <div className="flex items-baseline gap-1 mt-0.5">
                            <span className="text-xl font-extrabold text-amber-600">
                                {suggestionsData?.kpis?.pending_orders_count || customerOrders.length}
                            </span>
                            <span className="text-[11px] text-slate-500 font-medium">pedidos</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* BARRA DE CONTROLES: NAVEGACIÓN DE FECHA, VISTAS Y FILTROS */}
            <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-sm">
                {/* Selector de Mes / Navegación */}
                <div className="flex items-center justify-between sm:justify-start gap-2">
                    <button
                        type="button"
                        onClick={() => {
                            const d = new Date(currentDate);
                            d.setMonth(d.getMonth() - 1);
                            setCurrentDate(d);
                        }}
                        className="p-2 rounded-xl hover:bg-slate-100 text-slate-600 transition-colors"
                        title="Mes Anterior"
                    >
                        <ChevronLeft className="w-5 h-5" />
                    </button>

                    <button
                        type="button"
                        onClick={() => setCurrentDate(new Date())}
                        className="px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700 transition-colors"
                    >
                        Hoy
                    </button>

                    <button
                        type="button"
                        onClick={() => {
                            const d = new Date(currentDate);
                            d.setMonth(d.getMonth() + 1);
                            setCurrentDate(d);
                        }}
                        className="p-2 rounded-xl hover:bg-slate-100 text-slate-600 transition-colors"
                        title="Mes Siguiente"
                    >
                        <ChevronRight className="w-5 h-5" />
                    </button>

                    <h2 className="text-sm sm:text-base font-bold text-slate-900 ml-1">
                        {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
                    </h2>
                </div>

                {/* Vistas (Mes / Semana / Lista) y Filtros */}
                <div className="flex flex-wrap items-center gap-2">
                    {/* Búsqueda */}
                    <div className="relative flex-1 sm:w-48">
                        <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Buscar lote, operario..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                        />
                    </div>

                    {/* Filtro Perfil */}
                    <select
                        value={profileFilter}
                        onChange={(e) => setProfileFilter(e.target.value)}
                        className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:outline-none"
                    >
                        <option value="todos">Todos los perfiles</option>
                        {PRODUCT_PROFILES.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                    </select>

                    {/* Filtro Estado */}
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:outline-none"
                    >
                        <option value="todos">Todos los estados</option>
                        <option value="programado">Programado</option>
                        <option value="en_preparacion">En Preparación</option>
                        <option value="en_proceso">En Proceso</option>
                        <option value="completado">Completado</option>
                        <option value="cancelado">Cancelado</option>
                    </select>

                    {/* Switcher de Vista */}
                    <div className="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200/80">
                        <button
                            type="button"
                            onClick={() => setCalendarView('month')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                calendarView === 'month' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                            }`}
                        >
                            <CalendarDays className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Mes</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setCalendarView('list')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                calendarView === 'list' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                            }`}
                        >
                            <List className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Lista / Agenda</span>
                        </button>
                    </div>

                    <button
                        type="button"
                        onClick={fetchProductions}
                        disabled={loading}
                        className="p-2 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-500 transition-colors"
                        title="Actualizar"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* ========================================================================= */}
            {/* VISTA 1: CUADRÍCULA MENSUAL CON DRAG AND DROP */}
            {/* ========================================================================= */}
            {calendarView === 'month' && (
                <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
                    {/* Encabezado Días de la Semana */}
                    <div className="grid grid-cols-7 border-b border-slate-200/80 bg-slate-50/80 text-center py-2.5 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                        <div>Lun</div>
                        <div>Mar</div>
                        <div>Mié</div>
                        <div>Jue</div>
                        <div>Vie</div>
                        <div className="text-slate-400">Sáb</div>
                        <div className="text-slate-400">Dom</div>
                    </div>

                    {/* Matriz de Días */}
                    <div className="grid grid-cols-7 divide-x divide-y divide-slate-100">
                        {calendarMonthDays.map((cell, index) => {
                            const dayProds = getProductionsForDate(cell.dateStr);
                            const isToday = cell.dateStr === todayStr;
                            const isDropTarget = dragOverDate === cell.dateStr;

                            return (
                                <div
                                    key={index}
                                    onDragOver={(e) => handleDragOver(e, cell.dateStr)}
                                    onDragLeave={handleDragLeave}
                                    onDrop={(e) => handleDrop(e, cell.dateStr)}
                                    className={`min-h-[125px] sm:min-h-[145px] p-1.5 sm:p-2 flex flex-col transition-all group ${
                                        cell.isCurrentMonth ? 'bg-white' : 'bg-slate-50/50 opacity-60'
                                    } ${isDropTarget ? 'bg-indigo-50/80 ring-2 ring-indigo-400 ring-inset' : ''}`}
                                >
                                    {/* Número del día y botón rápido + */}
                                    <div className="flex items-center justify-between mb-1">
                                        <span
                                            className={`text-xs font-bold rounded-lg w-6 h-6 flex items-center justify-center ${
                                                isToday
                                                    ? 'bg-indigo-600 text-white shadow-sm'
                                                    : cell.isCurrentMonth
                                                    ? 'text-slate-700'
                                                    : 'text-slate-400'
                                            }`}
                                        >
                                            {cell.dayNumber}
                                        </span>

                                        <button
                                            type="button"
                                            onClick={() => handleOpenCreateModal(cell.dateStr)}
                                            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-indigo-50 text-indigo-600 rounded-md transition-all text-xs"
                                            title={`Programar producción para ${cell.dateStr}`}
                                        >
                                            <Plus className="w-3.5 h-3.5" />
                                        </button>
                                    </div>

                                    {/* Lista de Producciones del Día */}
                                    <div className="space-y-1.5 flex-1 overflow-y-auto max-h-[120px] pr-0.5">
                                        {dayProds.map((prod) => {
                                            const badgeStyle = getProfileBadgeStyle(prod.product_profile);
                                            const tasksDone = (prod.tasks || []).filter(t => t.checklist_status === 'completado').length;
                                            const tasksTotal = (prod.tasks || []).length;

                                            return (
                                                <div
                                                    key={prod.id}
                                                    draggable={true}
                                                    onDragStart={(e) => handleDragStart(e, prod)}
                                                    onClick={() => handleOpenEditModal(prod)}
                                                    className={`p-1.5 rounded-lg border text-left cursor-grab active:cursor-grabbing transition-all hover:shadow-md ${badgeStyle.card} ${
                                                        draggedItem?.id === prod.id ? 'opacity-40' : ''
                                                    }`}
                                                >
                                                    <div className="flex items-center justify-between gap-1">
                                                        <div className="flex items-center gap-1 min-w-0">
                                                            <span className="font-bold text-[11px] text-slate-900 truncate">
                                                                {prod.lot_code}
                                                            </span>
                                                            <span
                                                                className="text-[8px] font-extrabold px-1 py-0.2 rounded bg-indigo-50 text-indigo-700 border border-indigo-200/60 shrink-0"
                                                                title={`Día Juliano: ${getJulianDayInfo(prod.production_date).dayOfYearStr} / 365`}
                                                            >
                                                                J-{getJulianDayInfo(prod.production_date).dayOfYearStr}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-1 shrink-0">
                                                            {!isJulianLotCode(prod.lot_code) && (
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleConvertLotToJulian(prod.id);
                                                                    }}
                                                                    className="p-0.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-800 text-[8px] font-bold transition-all flex items-center"
                                                                    title="Convertir a Lote Juliano"
                                                                >
                                                                    <Wand2 className="w-2.5 h-2.5" />
                                                                </button>
                                                            )}
                                                            {prod.priority === 'urgente' && (
                                                                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" title="Prioridad Urgente" />
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="text-[10px] font-semibold text-slate-600 truncate mt-0.5">
                                                        {prod.product_profile}
                                                    </div>

                                                    <div className="flex items-center justify-between text-[9px] text-slate-500 mt-1">
                                                        <span>{parseFloat(prod.target_quantity_lbs || 0).toLocaleString()} Lbs</span>
                                                        {tasksTotal > 0 && (
                                                            <span
                                                                className={`font-semibold px-1 rounded ${
                                                                    tasksDone === tasksTotal ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                                                                }`}
                                                            >
                                                                {tasksDone}/{tasksTotal} roles
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* Badge de sugerencia IA si aplica */}
                                                    {prod.suggestion_source && prod.suggestion_source.includes('coproduct') && (
                                                        <div className="mt-1 flex items-center gap-1 text-[8px] font-bold text-emerald-700 bg-emerald-100/80 px-1 py-0.2 rounded">
                                                            <Split className="w-2.5 h-2.5" />
                                                            <span>Yema + H2O</span>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ========================================================================= */}
            {/* VISTA 2: LISTA / AGENDA TABULAR */}
            {/* ========================================================================= */}
            {calendarView === 'list' && (
                <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200/80 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                                    <th className="px-4 py-3">Fecha & Hora</th>
                                    <th className="px-4 py-3">Lote Asignado</th>
                                    <th className="px-4 py-3">Perfil & Presentación</th>
                                    <th className="px-4 py-3 text-right">Cantidad (Lbs)</th>
                                    <th className="px-4 py-3 text-center">Sólidos %</th>
                                    <th className="px-4 py-3">Operador / Equipo</th>
                                    <th className="px-4 py-3">Estado Lote</th>
                                    <th className="px-4 py-3 text-center">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filteredProductions.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="px-4 py-8 text-center text-slate-500 font-medium">
                                            No se encontraron producciones programadas con los filtros seleccionados.
                                        </td>
                                    </tr>
                                ) : (
                                    filteredProductions.map((prod) => {
                                        const badgeStyle = getProfileBadgeStyle(prod.product_profile);
                                        const tasksDone = (prod.tasks || []).filter(t => t.checklist_status === 'completado').length;
                                        const tasksTotal = (prod.tasks || []).length;
                                        const isBatchRunning = prod.status === 'en_proceso';

                                        return (
                                            <tr key={prod.id} className="hover:bg-slate-50/70 transition-colors">
                                                <td className="px-4 py-3">
                                                    <div className="font-bold text-slate-900">
                                                        {prod.production_date ? new Date(prod.production_date).toLocaleDateString('es-SV', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }) : 'N/A'}
                                                    </div>
                                                    <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                                                        <Clock className="w-3 h-3" />
                                                        {prod.start_time ? prod.start_time.slice(0, 5) : '06:00'} - {prod.end_time ? prod.end_time.slice(0, 5) : '14:00'}
                                                    </div>
                                                </td>

                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        <span className="font-bold text-slate-900">{prod.lot_code}</span>
                                                        <span
                                                            className="text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200/60"
                                                            title={`Día Juliano: ${getJulianDayInfo(prod.production_date).dayOfYearStr}`}
                                                        >
                                                            J-{getJulianDayInfo(prod.production_date).dayOfYearStr}
                                                        </span>
                                                        {!isJulianLotCode(prod.lot_code) && (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleConvertLotToJulian(prod.id)}
                                                                className="px-1.5 py-0.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-800 text-[9px] font-bold flex items-center gap-1 transition-all"
                                                                title="Convertir a Lote Juliano"
                                                            >
                                                                <Wand2 className="w-2.5 h-2.5" />
                                                                <span>Juliano</span>
                                                            </button>
                                                        )}
                                                        {prod.priority === 'urgente' && (
                                                            <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold">
                                                                Urgente
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>

                                                <td className="px-4 py-3">
                                                    <span className={`inline-block px-2 py-0.5 rounded-md border text-[11px] font-bold ${badgeStyle.bg}`}>
                                                        {prod.product_profile}
                                                    </span>
                                                    <div className="text-[11px] text-slate-500 mt-0.5">{prod.presentation}</div>
                                                </td>

                                                <td className="px-4 py-3 text-right font-bold text-slate-900">
                                                    {parseFloat(prod.target_quantity_lbs || 0).toLocaleString()} Lbs
                                                </td>

                                                <td className="px-4 py-3 text-center">
                                                    <span className="font-semibold text-slate-700">{prod.target_solids_pct || '22.5'}%</span>
                                                </td>

                                                <td className="px-4 py-3">
                                                    <div className="font-medium text-slate-800 flex items-center gap-1.5">
                                                        <User className="w-3.5 h-3.5 text-slate-400" />
                                                        {prod.assigned_operator_name || 'Sin asignar'}
                                                    </div>
                                                    {tasksTotal > 0 && (
                                                        <div className="text-[10px] text-slate-500 mt-0.5">
                                                            Checklist: <span className="font-bold text-emerald-600">{tasksDone}</span> de {tasksTotal} tareas
                                                        </div>
                                                    )}
                                                </td>

                                                <td className="px-4 py-3">
                                                    <span
                                                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                                            prod.status === 'completado'
                                                                ? 'bg-emerald-100 text-emerald-700'
                                                                : prod.status === 'en_proceso'
                                                                ? 'bg-blue-100 text-blue-700 animate-pulse'
                                                                : prod.status === 'cancelado'
                                                                ? 'bg-slate-200 text-slate-600'
                                                                : 'bg-amber-100 text-amber-700'
                                                        }`}
                                                    >
                                                        {prod.status}
                                                    </span>
                                                </td>

                                                <td className="px-4 py-3 text-center">
                                                    <div className="flex items-center justify-center gap-1">
                                                        {!prod.batch_id && prod.status === 'programado' && (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleStartBatchInPlant(prod.id, prod.lot_code)}
                                                                className="p-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 transition-colors"
                                                                title="Iniciar lote real en planta"
                                                            >
                                                                <Play className="w-4 h-4 fill-emerald-600" />
                                                            </button>
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={() => handleOpenEditModal(prod)}
                                                            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors"
                                                            title="Editar detalles y mezcla"
                                                        >
                                                            <Edit3 className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleDeleteProduction(prod.id, prod.lot_code)}
                                                            disabled={isBatchRunning}
                                                            className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 transition-colors disabled:opacity-30"
                                                            title="Eliminar"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ========================================================================= */}
            {/* MODAL 1: CREAR / EDITAR PRODUCCIÓN PROGRAMADA Y ROLES DE FÁBRICA */}
            {/* ========================================================================= */}
            <Modal
                isOpen={isFormModalOpen}
                onClose={() => setIsFormModalOpen(false)}
                title={formData.id ? `Editar Producción: ${formData.lot_code}` : 'Nueva Producción en Calendario'}
                maxWidth="max-w-4xl"
            >
                <form onSubmit={handleSaveProduction} className="space-y-5">
                    {/* 1. Datos Principales del Lote */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-slate-50/70 p-3.5 rounded-xl border border-slate-200/80">
                        <div>
                            <label className="text-[11px] font-bold text-slate-600 uppercase block mb-1">
                                Fecha de Producción *
                            </label>
                            <input
                                type="date"
                                required
                                value={formData.production_date}
                                onChange={(e) => {
                                    const newDate = e.target.value;
                                    const newJulianLot = generateJulianLotCode(newDate, 1, julianFormat);
                                    setFormData({
                                        ...formData,
                                        production_date: newDate,
                                        lot_code: formData.id ? formData.lot_code : newJulianLot
                                    });
                                }}
                                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                            />
                        </div>

                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <label className="text-[11px] font-bold text-slate-600 uppercase">
                                    Lote (Calendario Juliano) *
                                </label>
                                <div className="flex items-center gap-1.5">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const nextFmt = julianFormat === 'standard' ? 'andelsa' : 'standard';
                                            setJulianFormat(nextFmt);
                                            const updatedLot = generateJulianLotCode(formData.production_date, 1, nextFmt);
                                            setFormData({ ...formData, lot_code: updatedLot });
                                            toast.info(`Formato cambiado a: ${nextFmt === 'standard' ? 'Estándar (LOTE-YYJJJ-NN)' : 'ANDELSA (NN - JJJ - YY)'}`);
                                        }}
                                        className="text-[10px] text-slate-500 hover:text-indigo-600 flex items-center gap-1 font-semibold px-1 py-0.5 rounded hover:bg-slate-100 transition-colors"
                                        title="Alternar formato: Estándar vs ANDELSA"
                                    >
                                        <ArrowRightLeft className="w-2.5 h-2.5" />
                                        <span>{julianFormat === 'standard' ? 'Std' : 'Andelsa'}</span>
                                    </button>
                                    <span
                                        className="text-[10px] font-black px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-700 border border-indigo-200"
                                        title="Día del año según calendario juliano (1..365)"
                                    >
                                        Día {getJulianDayInfo(formData.production_date).dayOfYearStr}
                                    </span>
                                </div>
                            </div>
                            <div className="relative">
                                <input
                                    type="text"
                                    required
                                    value={formData.lot_code}
                                    onChange={(e) => setFormData({ ...formData, lot_code: e.target.value })}
                                    placeholder="ej. LOTE-26252-01"
                                    className="w-full bg-white border border-slate-300 rounded-xl pl-3 pr-8 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                                />
                                <button
                                    type="button"
                                    onClick={() => {
                                        const refreshed = generateJulianLotCode(formData.production_date, 1, julianFormat);
                                        setFormData({ ...formData, lot_code: refreshed });
                                        toast.info(`Lote juliano generado: ${refreshed}`);
                                    }}
                                    className="absolute right-2 top-2.5 text-slate-400 hover:text-indigo-600 transition-colors"
                                    title="Regenerar Lote Juliano"
                                >
                                    <RefreshCw className="w-3.5 h-3.5" />
                                </button>
                            </div>
                            {!isJulianLotCode(formData.lot_code) && formData.lot_code && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        const converted = convertGregorianLotToJulian(formData.lot_code, formData.production_date);
                                        setFormData({ ...formData, lot_code: converted });
                                        toast.success(`Lote convertido a Juliano: ${converted}`);
                                    }}
                                    className="mt-1 text-[10px] font-bold text-amber-700 hover:text-amber-800 flex items-center gap-1"
                                >
                                    <Wand2 className="w-3 h-3" />
                                    <span>Convertir a Juliano ({convertGregorianLotToJulian(formData.lot_code, formData.production_date)})</span>
                                </button>
                            )}
                        </div>

                        <div>
                            <label className="text-[11px] font-bold text-slate-600 uppercase block mb-1">
                                Hora Inicio - Fin
                            </label>
                            <div className="flex items-center gap-1.5">
                                <input
                                    type="time"
                                    value={formData.start_time}
                                    onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                                    className="w-full bg-white border border-slate-300 rounded-xl px-2 py-2 text-xs font-semibold text-slate-800"
                                />
                                <span className="text-slate-400">-</span>
                                <input
                                    type="time"
                                    value={formData.end_time}
                                    onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                                    className="w-full bg-white border border-slate-300 rounded-xl px-2 py-2 text-xs font-semibold text-slate-800"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="text-[11px] font-bold text-slate-600 uppercase block mb-1">
                                Prioridad
                            </label>
                            <select
                                value={formData.priority}
                                onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none"
                            >
                                <option value="baja">Baja</option>
                                <option value="media">Media (Estándar)</option>
                                <option value="alta">Alta</option>
                                <option value="urgente">Urgente (Prioritaria)</option>
                            </select>
                        </div>
                    </div>

                    {/* 2. Selección de Perfil de Producto y Parámetros */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        <div className="sm:col-span-2">
                            <label className="text-[11px] font-bold text-slate-600 uppercase block mb-1">
                                Perfil del Producto *
                            </label>
                            <select
                                value={formData.product_profile}
                                onChange={(e) => handleProfileChange(e.target.value)}
                                className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                            >
                                {PRODUCT_PROFILES.map(p => (
                                    <option key={p.id} value={p.id}>{p.name} - ({p.desc})</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="text-[11px] font-bold text-slate-600 uppercase block mb-1">
                                Presentación
                            </label>
                            <select
                                value={formData.presentation}
                                onChange={(e) => setFormData({ ...formData, presentation: e.target.value })}
                                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800"
                            >
                                {PRESENTATIONS.map(pres => (
                                    <option key={pres} value={pres}>{pres}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="text-[11px] font-bold text-slate-600 uppercase block mb-1">
                                Cantidad Objetivo (Lbs) *
                            </label>
                            <input
                                type="number"
                                required
                                step="100"
                                min="100"
                                value={formData.target_quantity_lbs}
                                onChange={(e) => handleQuantityChange(e.target.value)}
                                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                            />
                        </div>
                    </div>

                    {/* 3. MEZCLA / FORMULACIÓN A REALIZAR (BOM) */}
                    <div className="p-4 rounded-xl border border-indigo-200 bg-indigo-50/40 space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Split className="w-4 h-4 text-indigo-600" />
                                <span className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                                    Desglose de Mezcla / Formulación BOM
                                </span>
                            </div>
                            <span className="text-[11px] font-bold text-indigo-700 bg-indigo-100 px-2.5 py-0.5 rounded-full">
                                Sólidos Esperados: {formData.target_solids_pct}%
                            </span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                            <div className="bg-white p-2.5 rounded-lg border border-indigo-100">
                                <span className="text-[10px] text-slate-500 font-semibold block">Huevo Cáscara Estimado:</span>
                                <span className="font-extrabold text-slate-900 text-sm">
                                    {formData.mix_formula_json?.raw_egg_boxes || 0} cajas
                                </span>
                            </div>

                            <div className="bg-white p-2.5 rounded-lg border border-indigo-100">
                                <span className="text-[10px] text-slate-500 font-semibold block">Huevo Líquido Base:</span>
                                <span className="font-extrabold text-slate-900 text-sm">
                                    {formData.mix_formula_json?.raw_liquid_lbs?.toLocaleString() || 0} Lbs
                                </span>
                            </div>

                            <div className="bg-white p-2.5 rounded-lg border border-indigo-100">
                                <span className="text-[10px] text-slate-500 font-semibold block">Aditivo H2O Purificada:</span>
                                <span className="font-extrabold text-emerald-600 text-sm">
                                    {formData.mix_formula_json?.water_h2o_lbs?.toLocaleString() || 0} Lbs
                                </span>
                                {formData.mix_formula_json?.water_bottles > 0 && (
                                    <span className="text-[10px] text-slate-400 block">
                                        (~{formData.mix_formula_json.water_bottles} garrafas)
                                    </span>
                                )}
                            </div>

                            <div className="bg-white p-2.5 rounded-lg border border-indigo-100">
                                <span className="text-[10px] text-slate-500 font-semibold block">Ácido Cítrico Estabilizador:</span>
                                <span className="font-extrabold text-slate-900 text-sm">
                                    {formData.mix_formula_json?.citric_acid_lbs || '0.00'} Lbs
                                </span>
                            </div>
                        </div>

                        {formData.mix_formula_json?.notes && (
                            <p className="text-[11px] text-slate-600 bg-white/80 p-2.5 rounded-lg border border-indigo-100/80 leading-relaxed">
                                <strong>Instrucciones Operativas de Mezcla:</strong> {formData.mix_formula_json.notes}
                            </p>
                        )}
                    </div>

                    {/* 4. ASIGNACIÓN DE ROLES POR USUARIO DE FÁBRICA Y CHECKLIST */}
                    <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                                <span className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                                    Asignación de Roles de Fábrica & Checklist de Preparación
                                </span>
                            </div>
                            <span className="text-[11px] text-slate-500 font-medium">
                                Insumos listos antes de arrancar
                            </span>
                        </div>

                        {/* Input para agregar tarea */}
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 bg-white p-2.5 rounded-xl border border-slate-200">
                            <div className="sm:col-span-3">
                                <select
                                    value={newTaskRole}
                                    onChange={(e) => {
                                        setNewTaskRole(e.target.value);
                                        setNewTaskDesc(DEFAULT_PRESETS_BY_ROLE[e.target.value] || '');
                                    }}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-800"
                                >
                                    {FACTORY_ROLES.map(role => (
                                        <option key={role} value={role}>{role}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="sm:col-span-3">
                                <select
                                    value={newTaskUser}
                                    onChange={(e) => setNewTaskUser(e.target.value)}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 font-medium"
                                >
                                    <option value="">Seleccionar Operario...</option>
                                    {factoryUsers.map(u => (
                                        <option key={u.id} value={u.id}>{u.nombre} ({u.username})</option>
                                    ))}
                                </select>
                            </div>

                            <div className="sm:col-span-5">
                                <input
                                    type="text"
                                    placeholder="Tarea de preparación..."
                                    value={newTaskDesc}
                                    onChange={(e) => setNewTaskDesc(e.target.value)}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800"
                                />
                            </div>

                            <div className="sm:col-span-1 flex items-center">
                                <button
                                    type="button"
                                    onClick={handleAddTask}
                                    className="w-full p-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg flex items-center justify-center text-xs"
                                    title="Agregar Tarea"
                                >
                                    <Plus className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* Lista de tareas añadidas */}
                        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                            {formData.tasks.length === 0 ? (
                                <p className="text-xs text-slate-400 italic py-2 text-center">
                                    No se han asignado roles ni tareas de preparación aún.
                                </p>
                            ) : (
                                formData.tasks.map((task, idx) => (
                                    <div
                                        key={idx}
                                        className="flex items-center justify-between gap-2 p-2 bg-white rounded-lg border border-slate-200/80 text-xs"
                                    >
                                        <div className="flex items-center gap-2 truncate">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (task.id) {
                                                        handleToggleTask(task.id);
                                                    }
                                                    setFormData(prev => ({
                                                        ...prev,
                                                        tasks: prev.tasks.map((t, i) => i === idx ? {
                                                            ...t,
                                                            checklist_status: t.checklist_status === 'completado' ? 'pendiente' : 'completado'
                                                        } : t)
                                                    }));
                                                }}
                                                className="shrink-0 text-slate-400 hover:text-emerald-600 transition-colors"
                                                title={task.checklist_status === 'completado' ? 'Marcar como pendiente' : 'Marcar como completada'}
                                            >
                                                {task.checklist_status === 'completado' ? (
                                                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                                ) : (
                                                    <Circle className="w-4 h-4 text-slate-300" />
                                                )}
                                            </button>
                                            <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-bold text-[10px] shrink-0">
                                                {task.factory_role}
                                            </span>
                                            <span className="font-semibold text-slate-700 truncate">
                                                {task.user_name}
                                            </span>
                                            <span className="text-slate-500 text-[11px] truncate">
                                                - {task.task_description}
                                            </span>
                                        </div>

                                        <button
                                            type="button"
                                            onClick={() => handleRemoveTask(idx)}
                                            className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* 5. Operador Líder, Estado y Notas */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                            <label className="text-[11px] font-bold text-slate-600 uppercase block mb-1">
                                Operador Líder / Responsable
                            </label>
                            <select
                                value={formData.assigned_operator_id}
                                onChange={(e) => {
                                    const u = factoryUsers.find(usr => String(usr.id) === e.target.value);
                                    setFormData({
                                        ...formData,
                                        assigned_operator_id: e.target.value,
                                        assigned_operator_name: u ? u.nombre : ''
                                    });
                                }}
                                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800"
                            >
                                <option value="">Seleccionar Operador...</option>
                                {factoryUsers.map(u => (
                                    <option key={u.id} value={u.id}>{u.nombre}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="text-[11px] font-bold text-slate-600 uppercase block mb-1">
                                Estado del Evento
                            </label>
                            <select
                                value={formData.status}
                                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800"
                            >
                                <option value="programado">Programado</option>
                                <option value="en_preparacion">En Preparación</option>
                                <option value="en_proceso">En Proceso</option>
                                <option value="completado">Completado</option>
                                <option value="cancelado">Cancelado</option>
                            </select>
                        </div>

                        <div>
                            <label className="text-[11px] font-bold text-slate-600 uppercase block mb-1">
                                Notas Adicionales
                            </label>
                            <input
                                type="text"
                                placeholder="ej. Cliente solicita envío antes de mediodía"
                                value={formData.notes}
                                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-800"
                            />
                        </div>
                    </div>

                    {/* Botones de Acción */}
                    <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-100">
                        <button
                            type="button"
                            onClick={() => setIsFormModalOpen(false)}
                            className="px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-bold transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md shadow-indigo-200 active:scale-95 transition-all disabled:opacity-50"
                        >
                            {isSubmitting ? 'Guardando...' : formData.id ? 'Guardar Cambios' : 'Programar Producción'}
                        </button>
                    </div>
                </form>
            </Modal>

            {/* ========================================================================= */}
            {/* MODAL 2: MOTOR DE SUGERENCIAS INTELIGENTES (ARBITRAJE Y OPTIMIZACIÓN) */}
            {/* ========================================================================= */}
            <Modal
                isOpen={isSuggestionsDrawerOpen}
                onClose={() => setIsSuggestionsDrawerOpen(false)}
                title="Sugerencias Inteligentes de Producción por IA"
                maxWidth="max-w-5xl"
            >
                <div className="space-y-4">
                    {/* Header Tabs */}
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
                        <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl">
                            <button
                                type="button"
                                onClick={() => setSuggestionsTab('monthly')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                                    suggestionsTab === 'monthly'
                                        ? 'bg-white text-indigo-700 shadow-sm'
                                        : 'text-slate-600 hover:text-slate-900'
                                }`}
                            >
                                <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                                <span>Plan Mensual Completo (IA)</span>
                                <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
                                    {monthlyPlanData?.monthly_plan?.length || 0}
                                </span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setSuggestionsTab('tactical')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                                    suggestionsTab === 'tactical'
                                        ? 'bg-white text-emerald-700 shadow-sm'
                                        : 'text-slate-600 hover:text-slate-900'
                                }`}
                            >
                                <CalendarCheck className="w-3.5 h-3.5 text-emerald-600" />
                                <span>Sugerencias Tácticas</span>
                                <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                                    {suggestionsData?.suggestions?.length || 0}
                                </span>
                            </button>
                        </div>

                        {suggestionsTab === 'monthly' && (
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => fetchMonthlyPlan(currentDate)}
                                    disabled={loadingMonthlyPlan}
                                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-medium flex items-center gap-1.5 transition-colors"
                                    title="Recalcular sugerencias del mes"
                                >
                                    <RefreshCw className={`w-3.5 h-3.5 ${loadingMonthlyPlan ? 'animate-spin text-indigo-600' : ''}`} />
                                    <span>Recalcular</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={handleApplyMonthlyPlan}
                                    disabled={applyingPlan || selectedPlanRuns.length === 0}
                                    className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm shadow-indigo-200 transition-all disabled:opacity-50"
                                >
                                    <CheckSquare className="w-3.5 h-3.5" />
                                    <span>
                                        {applyingPlan
                                            ? 'Programando...'
                                            : `Aplicar ${selectedPlanRuns.length} al Calendario`}
                                    </span>
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Contenido Pestaña 1: Plan Mensual Completo */}
                    {suggestionsTab === 'monthly' && (
                        <div className="space-y-4">
                            {/* Banner Informativo */}
                            <div className="p-3.5 bg-gradient-to-r from-indigo-50 via-sky-50 to-emerald-50 border border-indigo-200 rounded-xl flex items-start gap-3">
                                <Sparkles className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                                <div className="text-xs text-slate-700 leading-relaxed">
                                    <strong className="text-indigo-900 font-bold">Proyección Mensual Inteligente:</strong> Este plan mensual se genera analizando la <strong>demanda confirmada</strong> en pedidos de clientes, los <strong>acuerdos de suministro recurrentes</strong> y el <strong>histórico de ventas</strong>. Cada corrida incluye su <strong>Lote con Calendario Juliano</strong> pre-asignado y balancea los coproductos (Clara vs Formulado Yema + H2O) para minimizar desperdicios.
                                </div>
                            </div>

                            {loadingMonthlyPlan ? (
                                <div className="py-12 text-center text-slate-400 font-medium text-xs space-y-2">
                                    <RefreshCw className="w-6 h-6 animate-spin mx-auto text-indigo-600" />
                                    <p>Generando plan mensual optimizado con calendario juliano...</p>
                                </div>
                            ) : !monthlyPlanData ? (
                                <div className="py-8 text-center text-slate-500 text-xs font-medium">
                                    No se pudo cargar la sugerencia mensual. Presiona Recalcular.
                                </div>
                            ) : (
                                <>
                                    {/* Resumen KPIs del Mes */}
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                                        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                                            <span className="text-[10px] font-bold text-slate-500 uppercase block">Corridas Sugeridas</span>
                                            <div className="flex items-baseline gap-1.5 mt-1">
                                                <span className="text-lg font-black text-slate-900">
                                                    {monthlyPlanData.summary?.total_runs_suggested || 0}
                                                </span>
                                                <span className="text-[10px] font-semibold text-slate-500">lotes julianos</span>
                                            </div>
                                        </div>

                                        <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200">
                                            <span className="text-[10px] font-bold text-amber-800 uppercase block">Huevo Cáscara Total</span>
                                            <div className="flex items-baseline gap-1.5 mt-1">
                                                <span className="text-lg font-black text-amber-900">
                                                    {(monthlyPlanData.summary?.total_egg_boxes_needed || 0).toLocaleString()}
                                                </span>
                                                <span className="text-[10px] font-semibold text-amber-700">cajas req.</span>
                                            </div>
                                        </div>

                                        <div className="p-3 rounded-xl bg-teal-50/70 border border-teal-200">
                                            <span className="text-[10px] font-bold text-teal-800 uppercase block">Clara Pasteurizada</span>
                                            <div className="flex items-baseline gap-1.5 mt-1">
                                                <span className="text-lg font-black text-teal-900">
                                                    {(monthlyPlanData.summary?.projected_production_lbs?.clara || 0).toLocaleString()}
                                                </span>
                                                <span className="text-[10px] font-semibold text-teal-700">Lbs</span>
                                            </div>
                                        </div>

                                        <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200">
                                            <span className="text-[10px] font-bold text-emerald-800 uppercase block">Formulado (Yema+H2O)</span>
                                            <div className="flex items-baseline gap-1.5 mt-1">
                                                <span className="text-lg font-black text-emerald-900">
                                                    {(monthlyPlanData.summary?.projected_production_lbs?.formulado_yema_h2o || 0).toLocaleString()}
                                                </span>
                                                <span className="text-[10px] font-semibold text-emerald-700">Lbs</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Barra de Selección Masiva */}
                                    <div className="flex items-center justify-between px-1 py-0.5">
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const unscheduled = (monthlyPlanData.monthly_plan || []).filter(p => !p.already_scheduled);
                                                    if (selectedPlanRuns.length === unscheduled.length) {
                                                        setSelectedPlanRuns([]);
                                                    } else {
                                                        setSelectedPlanRuns(unscheduled);
                                                    }
                                                }}
                                                className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1.5"
                                            >
                                                <CheckSquare className="w-3.5 h-3.5" />
                                                <span>
                                                    {selectedPlanRuns.length === (monthlyPlanData.monthly_plan || []).filter(p => !p.already_scheduled).length
                                                        ? 'Deseleccionar Todas'
                                                        : 'Seleccionar Todas las Pendientes'}
                                                </span>
                                            </button>
                                            <span className="text-[11px] text-slate-400">|</span>
                                            <span className="text-[11px] font-medium text-slate-500">
                                                {selectedPlanRuns.length} de {(monthlyPlanData.monthly_plan || []).filter(p => !p.already_scheduled).length} seleccionadas para programar
                                            </span>
                                        </div>
                                    </div>

                                    {/* Lista de Corridas Planificadas */}
                                    <div className="space-y-2 max-h-[440px] overflow-y-auto pr-1">
                                        {monthlyPlanData.monthly_plan?.map((run) => {
                                            const isSelected = selectedPlanRuns.some(r => r.id === run.id);
                                            return (
                                                <div
                                                    key={run.id}
                                                    className={`p-3 rounded-xl border transition-all ${
                                                        run.already_scheduled
                                                            ? 'bg-slate-50/60 border-slate-200 opacity-60'
                                                            : isSelected
                                                            ? 'bg-indigo-50/40 border-indigo-300 shadow-sm'
                                                            : 'bg-white border-slate-200 hover:border-slate-300'
                                                    }`}
                                                >
                                                    <div className="flex items-start gap-3">
                                                        <input
                                                            type="checkbox"
                                                            disabled={run.already_scheduled}
                                                            checked={isSelected || run.already_scheduled}
                                                            onChange={() => {
                                                                if (run.already_scheduled) return;
                                                                if (isSelected) {
                                                                    setSelectedPlanRuns(selectedPlanRuns.filter(r => r.id !== run.id));
                                                                } else {
                                                                    setSelectedPlanRuns([...selectedPlanRuns, run]);
                                                                }
                                                            }}
                                                            className="mt-1 rounded text-indigo-600 focus:ring-indigo-500"
                                                        />

                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <span className="text-xs font-bold text-slate-900">
                                                                    {new Date(run.production_date + 'T12:00:00Z').toLocaleDateString('es-SV', {
                                                                        weekday: 'short',
                                                                        day: '2-digit',
                                                                        month: 'short'
                                                                    })}
                                                                </span>

                                                                <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 text-[10px] font-black border border-indigo-200">
                                                                    J-{run.julian_day}
                                                                </span>

                                                                <span className="font-mono text-[11px] font-bold text-slate-700">
                                                                    {run.lot_code}
                                                                </span>

                                                                <span className="text-xs font-semibold text-slate-800">
                                                                    • {run.product_type}
                                                                </span>

                                                                {run.already_scheduled ? (
                                                                    <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 text-[10px] font-bold ml-auto">
                                                                        Ya en Calendario
                                                                    </span>
                                                                ) : (
                                                                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold ml-auto">
                                                                        Sugerido IA
                                                                    </span>
                                                                )}
                                                            </div>

                                                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-[11px] text-slate-600">
                                                                <span><strong>Meta:</strong> {run.target_quantity_lbs?.toLocaleString()} Lbs ({run.presentation})</span>
                                                                <span><strong>Materia Prima:</strong> {run.mix_formula_json?.raw_egg_boxes} cajas</span>
                                                                {run.mix_formula_json?.water_bottles > 0 && (
                                                                    <span className="text-cyan-700 font-semibold">
                                                                        + {run.mix_formula_json.water_bottles} garrafas H2O
                                                                    </span>
                                                                )}
                                                            </div>

                                                            <p className="text-[11px] text-slate-500 mt-1 italic">
                                                                {run.rationale}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {/* Contenido Pestaña 2: Sugerencias Tácticas */}
                    {suggestionsTab === 'tactical' && (
                        <div className="space-y-3">
                            <div className="p-3.5 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl flex items-start gap-3">
                                <Sparkles className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                                <div className="text-xs text-emerald-950 leading-relaxed">
                                    <strong>Motor de Arbitraje Táctico:</strong> Analiza balances inmediatos de masa para sugerir reformulaciones de coproducto (evitando que la yema quede rezagada), secuencias óptimas de lavado CIP y priorización de pedidos críticos.
                                </div>
                            </div>

                            {loadingSuggestions ? (
                                <div className="py-8 text-center text-slate-400 font-medium text-xs">
                                    Analizando balance de masas y pedidos de clientes...
                                </div>
                            ) : suggestionsData?.suggestions?.length === 0 ? (
                                <div className="py-8 text-center text-slate-500 text-xs font-medium">
                                    No hay sugerencias tácticas pendientes en este momento. La línea está balanceada.
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {suggestionsData?.suggestions?.map((sug) => (
                                        <div
                                            key={sug.id}
                                            className="p-4 rounded-xl border border-slate-200 bg-white hover:border-emerald-300 transition-all shadow-sm space-y-3"
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <div>
                                                    <span className="text-[10px] font-black px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 uppercase">
                                                        {sug.badge}
                                                    </span>
                                                    <h3 className="text-sm font-bold text-slate-900 mt-1">
                                                        {sug.title}
                                                    </h3>
                                                </div>

                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setIsSuggestionsDrawerOpen(false);
                                                        handleOpenCreateModal(sug.suggested_production?.production_date, sug.suggested_production);
                                                    }}
                                                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm shadow-emerald-200 transition-all shrink-0"
                                                >
                                                    <Plus className="w-3.5 h-3.5" />
                                                    <span>Aplicar al Calendario</span>
                                                </button>
                                            </div>

                                            <p className="text-xs text-slate-600 leading-relaxed">
                                                {sug.summary}
                                            </p>

                                            {sug.economic_impact && (
                                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-lg text-[11px]">
                                                    {sug.economic_impact.boxes_saved && (
                                                        <div>
                                                            <span className="text-slate-500 block text-[10px]">Ahorro en Cajas:</span>
                                                            <strong className="text-emerald-700 font-bold">{sug.economic_impact.boxes_saved} cajas</strong>
                                                        </div>
                                                    )}
                                                    {sug.economic_impact.cost_savings_usd && (
                                                        <div>
                                                            <span className="text-slate-500 block text-[10px]">Ahorro Económico:</span>
                                                            <strong className="text-emerald-700 font-bold">
                                                                <Money value={sug.economic_impact.cost_savings_usd} />
                                                            </strong>
                                                        </div>
                                                    )}
                                                    {sug.economic_impact.cost_per_lb_formulated && (
                                                        <div>
                                                            <span className="text-slate-500 block text-[10px]">Costo Formulado:</span>
                                                            <strong className="text-slate-800 font-bold">{sug.economic_impact.cost_per_lb_formulated}</strong>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </Modal>

            {/* ========================================================================= */}
            {/* MODAL 3: GESTIÓN DE PEDIDOS DE CLIENTES DE OVOPRODUCTOS */}
            {/* ========================================================================= */}
            <Modal
                isOpen={isOrdersModalOpen}
                onClose={() => setIsOrdersModalOpen(false)}
                title="Pedidos de Clientes (Ovoproductos)"
                maxWidth="max-w-4xl"
            >
                <div className="space-y-5">
                    {/* Formulario de Nuevo Pedido */}
                    <form onSubmit={handleSaveOrder} className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3.5">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
                                <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                                <span>Registrar Nuevo Pedido para el Algoritmo de Sugerencias</span>
                            </span>
                            <span className="text-[10px] text-slate-500 font-medium">
                                Los precios se enlazan con el módulo de CRM
                            </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                            {/* CLIENTE OBLIGATORIO CON AUTOCOMPLETE */}
                            <div className="relative">
                                <label className="text-[10px] font-bold text-slate-600 uppercase block mb-1">
                                    Cliente * <span className="text-slate-400 font-normal">(Catálogo existente)</span>
                                </label>
                                <div className="relative">
                                    <input
                                        type="text"
                                        required
                                        placeholder="Buscar cliente existente..."
                                        value={customerSearchInput}
                                        onChange={handleCustomerInputChange}
                                        onFocus={() => {
                                            setShowCustomerDropdown(true);
                                            if (customerSearchResults.length === 0) searchCustomersList(customerSearchInput);
                                        }}
                                        className={`w-full bg-white border rounded-lg px-2.5 py-1.5 font-medium pr-8 transition-colors ${
                                            selectedCustomer 
                                                ? 'border-emerald-500 ring-1 ring-emerald-500/30 bg-emerald-50/20 text-slate-900 font-bold' 
                                                : customerSearchInput && !selectedCustomer
                                                    ? 'border-amber-400 bg-amber-50/10'
                                                    : 'border-slate-300'
                                        }`}
                                    />
                                    {selectedCustomer ? (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSelectedCustomer(null);
                                                setCustomerSearchInput('');
                                                setCustomerAgreements([]);
                                                setAgreedPriceNotice(null);
                                                setOrderForm(prev => ({ ...prev, customer_id: '', customer_name: '', price_per_lb: '' }));
                                                searchCustomersList('');
                                            }}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-rose-500 p-0.5 transition-colors"
                                            title="Quitar cliente seleccionado"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    ) : (
                                        <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                            {loadingCustomers ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-600" /> : <Search className="w-3.5 h-3.5" />}
                                        </div>
                                    )}
                                </div>

                                {/* Feedback de selección */}
                                {selectedCustomer && (
                                    <div className="flex items-center gap-1.5 mt-1 text-[10px] font-bold text-emerald-700">
                                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                        <span>Cliente existente (ID: {selectedCustomer.id})</span>
                                        {customerAgreements.length > 0 && (
                                            <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 px-1.5 py-0.2 rounded text-[9px]">
                                                {customerAgreements.length} acuerdo{customerAgreements.length > 1 ? 's' : ''} CRM
                                            </span>
                                        )}
                                    </div>
                                )}

                                {!selectedCustomer && customerSearchInput.trim().length > 0 && !showCustomerDropdown && (
                                    <p className="text-[10px] text-amber-600 mt-1 font-medium flex items-center gap-1">
                                        <AlertCircle className="w-3 h-3 text-amber-500" />
                                        <span>Debe coincidir con un cliente registrado en el sistema.</span>
                                    </p>
                                )}

                                {/* Dropdown flotante de catálogo de clientes */}
                                {showCustomerDropdown && (
                                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-52 overflow-y-auto divide-y divide-slate-100">
                                        {loadingCustomers ? (
                                            <div className="p-3 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                                                <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                                                <span>Buscando en catálogo...</span>
                                            </div>
                                        ) : customerSearchResults.length === 0 ? (
                                            <div className="p-3 text-center text-xs text-slate-400">
                                                No se encontró ningún cliente registrado con ese término.
                                            </div>
                                        ) : (
                                            customerSearchResults.map((cust) => (
                                                <div
                                                    key={cust.id}
                                                    onClick={() => handleSelectCustomer(cust)}
                                                    className="p-2.5 hover:bg-indigo-50/70 cursor-pointer transition-colors text-xs flex items-center justify-between"
                                                >
                                                    <div>
                                                        <div className="font-bold text-slate-800 flex items-center gap-1.5">
                                                            <Building2 className="w-3.5 h-3.5 text-indigo-500" />
                                                            <span>{cust.nombre}</span>
                                                        </div>
                                                        <div className="text-[10px] text-slate-500 mt-0.5">
                                                            {cust.nombre_comercial && cust.nombre_comercial !== cust.nombre && (
                                                                <span className="mr-2 italic text-slate-600 font-medium">"{cust.nombre_comercial}"</span>
                                                            )}
                                                            NIT: {cust.nit || 'N/A'} • NRC: {cust.nrc || 'N/A'}
                                                        </div>
                                                    </div>
                                                    <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full">
                                                        Elegir
                                                    </span>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* PRODUCTO REQUERIDO */}
                            <div>
                                <label className="text-[10px] font-bold text-slate-600 uppercase block mb-1">Producto Requerido *</label>
                                <select
                                    value={orderForm.product_type}
                                    onChange={(e) => handleProductTypeChange(e.target.value)}
                                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-medium"
                                >
                                    {PRODUCT_PROFILES.map(p => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                </select>
                            </div>

                            {/* CANTIDAD LBS */}
                            <div>
                                <label className="text-[10px] font-bold text-slate-600 uppercase block mb-1">Cantidad (Lbs) *</label>
                                <input
                                    type="number"
                                    required
                                    placeholder="ej. 5000"
                                    value={orderForm.quantity_lbs}
                                    onChange={(e) => setOrderForm({ ...orderForm, quantity_lbs: e.target.value })}
                                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-bold"
                                />
                            </div>

                            {/* FECHA DE ENTREGA */}
                            <div>
                                <label className="text-[10px] font-bold text-slate-600 uppercase block mb-1">Fecha de Entrega Requerida *</label>
                                <input
                                    type="date"
                                    required
                                    value={orderForm.required_delivery_date}
                                    onChange={(e) => setOrderForm({ ...orderForm, required_delivery_date: e.target.value })}
                                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-medium"
                                />
                            </div>

                            {/* PRECIO ACORDADO ($/LB) CON AUTO-PULL CRM */}
                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <label className="text-[10px] font-bold text-slate-600 uppercase">
                                        Precio Acordado ($/Lb)
                                    </label>
                                    {agreedPriceNotice?.type === 'crm' && (
                                        <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded animate-pulse">
                                            <Sparkles className="w-2.5 h-2.5 text-emerald-600" /> Auto CRM
                                        </span>
                                    )}
                                </div>
                                <MoneyInput
                                    value={orderForm.price_per_lb}
                                    onChange={(e) => {
                                        setOrderForm({ ...orderForm, price_per_lb: e.target.value });
                                        if (agreedPriceNotice?.type === 'crm') {
                                            setAgreedPriceNotice(prev => ({ ...prev, overridden: true }));
                                        }
                                    }}
                                    placeholder="ej. 1.25"
                                    step="0.0001"
                                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-medium text-xs focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                                />
                                {loadingAgreements ? (
                                    <p className="text-[10px] text-indigo-600 mt-1 flex items-center gap-1">
                                        <RefreshCw className="w-2.5 h-2.5 animate-spin" /> Verificando acuerdos en CRM...
                                    </p>
                                ) : agreedPriceNotice ? (
                                    <p className={`text-[10px] mt-1 font-medium flex items-center gap-1 ${
                                        agreedPriceNotice.type === 'crm' ? 'text-emerald-700' : 'text-slate-500'
                                    }`}>
                                        {agreedPriceNotice.type === 'crm' && <Check className="w-3 h-3 text-emerald-600" />}
                                        <span>{agreedPriceNotice.label}</span>
                                        {agreedPriceNotice.overridden && (
                                            <span className="text-amber-600 italic">(manual)</span>
                                        )}
                                    </p>
                                ) : null}
                            </div>

                            {/* BOTÓN GUARDAR */}
                            <div className="flex items-end">
                                <button
                                    type="submit"
                                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow transition-all flex items-center justify-center gap-1.5"
                                >
                                    <Plus className="w-4 h-4" />
                                    <span>Guardar Pedido</span>
                                </button>
                            </div>
                        </div>
                    </form>

                    {/* Tabla de Pedidos */}
                    <div className="overflow-x-auto border border-slate-200 rounded-xl">
                        <table className="w-full text-left text-xs">
                            <thead className="bg-slate-100 text-[10px] font-bold text-slate-600 uppercase">
                                <tr>
                                    <th className="px-3 py-2.5">Cliente</th>
                                    <th className="px-3 py-2.5">Producto</th>
                                    <th className="px-3 py-2.5 text-right">Cantidad (Lbs)</th>
                                    <th className="px-3 py-2.5 text-right">Precio ($/Lb)</th>
                                    <th className="px-3 py-2.5">Entrega</th>
                                    <th className="px-3 py-2.5">Estado</th>
                                    <th className="px-3 py-2.5 text-center">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {customerOrders.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="px-3 py-6 text-center text-slate-400 font-medium">
                                            No hay pedidos registrados todavía.
                                        </td>
                                    </tr>
                                ) : (
                                    customerOrders.map(order => (
                                        <tr key={order.id} className="hover:bg-slate-50 transition-colors">
                                            <td className="px-3 py-2">
                                                <div className="font-bold text-slate-900">{order.customer_name}</div>
                                                {order.customer_id && (
                                                    <span className="text-[10px] text-slate-400 font-normal">
                                                        Cliente ID #{order.customer_id}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-3 py-2 text-slate-700">{order.product_type}</td>
                                            <td className="px-3 py-2 text-right font-bold text-indigo-600">
                                                {parseFloat(order.quantity_lbs || 0).toLocaleString()} Lbs
                                            </td>
                                            <td className="px-3 py-2 text-right">
                                                <span className="font-bold text-slate-800">
                                                    <Money value={order.price_per_lb} />
                                                </span>
                                                <span className="text-[10px] text-slate-400 block font-normal">/ Lb</span>
                                            </td>
                                            <td className="px-3 py-2 text-slate-600">
                                                {order.required_delivery_date ? new Date(order.required_delivery_date).toLocaleDateString('es-SV', { timeZone: 'UTC' }) : 'N/A'}
                                            </td>
                                            <td className="px-3 py-2">
                                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                                                    {order.status}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                                <button
                                                    type="button"
                                                    onClick={() => handleDeleteOrder(order.id)}
                                                    className="p-1 hover:bg-red-50 text-red-500 rounded transition-colors"
                                                    title="Eliminar pedido"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </Modal>

            {/* ========================================================================= */}
            {/* MODAL 4: PLANIFICADOR DE MATERIA PRIMA E INSUMOS (MRP) */}
            {/* ========================================================================= */}
            <RawMaterialPlannerModal
                isOpen={isPlannerModalOpen}
                onClose={() => setIsPlannerModalOpen(false)}
                initialDate={currentDate}
            />
        </div>
    );
};

export default ProductionCalendar;
