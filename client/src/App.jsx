import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ConfirmProvider } from './context/ConfirmContext';

// Pages
import Login from './pages/Login';
import PublicDTE from './pages/PublicDTE';
import Dashboard from './pages/Dashboard';
import Companies from './pages/Companies';
import CompanyModules from './pages/CompanyModules';
import Branches from './pages/Branches';
import POS from './pages/POS';
import Customers from './pages/Customers';
import Products from './pages/Products';
import Sellers from './pages/Sellers';
import Users from './pages/Users';
import Roles from './pages/Roles';
import Providers from './pages/Providers';
import Categories from './pages/Categories';
import UserAccess from './pages/UserAccess';
import SmtpConfig from './pages/SmtpConfig';
import SystemSettings from './pages/SystemSettings';
import NotificacionesConfig from './pages/NotificacionesConfig';
import NotificacionesLista from './pages/NotificacionesLista';
import WhatsAppConfig from './pages/WhatsAppConfig';
import MenuItems from './pages/MenuItems';
import Transfers from './pages/Transfers';
import InventoryAdjustments from './pages/InventoryAdjustments';
import PhysicalInventory from './pages/PhysicalInventory';
import ScanInventory from './pages/ScanInventory';
import Kardex from './pages/Kardex';
import Purchases from './pages/Purchases';
import PurchasePeriod from './pages/PurchasePeriod';
import SalesTerminal from './pages/SalesTerminal';
import SalesHistory from './pages/SalesHistory';
import CustomerDiscounts from './pages/CustomerDiscounts';
import DiscountRules from './pages/DiscountRules';
import ChartOfAccounts from './pages/ChartOfAccounts';
import AccountingEntries from './pages/AccountingEntries';
import AccountingGenerate from './pages/AccountingGenerate';
import AccountingCorrelativos from './pages/AccountingCorrelativos';
import YearClosing from './pages/YearClosing';
import YearOpening from './pages/YearOpening';
import AccountingSettings from './pages/AccountingSettings';
import LibroDiario from './pages/AccountingReports/LibroDiario';
import LibroDiarioMayor from './pages/AccountingReports/LibroDiarioMayor';
import LibroMayor from './pages/AccountingReports/LibroMayor';
import BalanceComprobacion from './pages/AccountingReports/BalanceComprobacion';
import EstadoResultados from './pages/AccountingReports/EstadoResultados';
import BalanceGeneral from './pages/AccountingReports/BalanceGeneral';
import AnexoBalance from './pages/AccountingReports/AnexoBalance';
import BalanceComparativo from './pages/AccountingReports/BalanceComparativo';
import CambiosPatrimonio from './pages/AccountingReports/CambiosPatrimonio';
import FlujoEfectivo from './pages/AccountingReports/FlujoEfectivo';
import AuxiliarOperaciones from './pages/AccountingReports/AuxiliarOperaciones';
import ListadoPartidas from './pages/AccountingReports/ListadoPartidas';
import CedulaAuditoria from './pages/AccountingReports/CedulaAuditoria';
import Retenciones from './pages/AccountingReports/Retenciones';
import DailySalesReport from './pages/DailySalesReport';
import SalesByCustomerReport from './pages/SalesByCustomerReport';
import Contingency from './pages/Contingency';
import Eret from './pages/Eret';
import AuditLog from './pages/AuditLog';
import LogViewer from './pages/LogViewer';
import ConnectedUsers from './pages/ConnectedUsers';
import Changelog from './pages/Changelog';
import KeyboardShortcuts from './pages/KeyboardShortcuts';
import CashClosing from './pages/CashClosing';
import Combos from './pages/Combos';
import CustomerStatement from './pages/CustomerStatement';
import AddPayment from './pages/AddPayment';
import ProviderStatement from './pages/ProviderStatement';
import AddProviderPayment from './pages/AddProviderPayment';
import InventoryStockReport from './pages/InventoryStockReport';
import InventoryMovementsReport from './pages/InventoryMovementsReport';
import InventoryValuationReport from './pages/InventoryValuationReport';
import InventoryTurnoverReport from './pages/InventoryTurnoverReport';
import CustomerBalancesReport from './pages/CustomerBalancesReport';
import CustomerStatementReport from './pages/CustomerStatementReport';
import ProviderBalancesReport from './pages/ProviderBalancesReport';
import FuelPrices from './pages/FuelPrices';
import SalesByCategoryReport from './pages/SalesByCategoryReport';
import SalesByPOSReport from './pages/SalesByPOSReport';
import SalesDetailReport from './pages/SalesDetailReport';
import ArqueosReport from './pages/ArqueosReport';
import StoreProfitabilityReport from './pages/StoreProfitabilityReport';
import SalesReport from './pages/SalesReport';
import PendingDocumentsDetailedReport from './pages/PendingDocumentsDetailedReport';
import ProviderPendingDocumentsDetailedReport from './pages/ProviderPendingDocumentsDetailedReport';
import Expenses from './pages/Expenses';
import ExpenseReport from './pages/ExpenseReport';
import PurchaseReport from './pages/PurchaseReport';
import PurchaseChecks from './pages/PurchaseChecks';
import PurchaseCheckReport from './pages/PurchaseCheckReport';
import Quedan from './pages/Quedan';
import QuedanReport from './pages/QuedanReport';

// Gas Station Pages
import GasDistributors from './pages/GasDistributors';
import Islands from './pages/Islands';
import Nozzles from './pages/Nozzles';
import Tanks from './pages/Tanks';
import GasCloseout from './pages/GasCloseout';
import GasOrders from './pages/GasOrders';
import GasReadingHistory from './pages/GasReadingHistory';
import GasExpenseCategories from './pages/GasExpenseCategories';
import GasStationConfig from './pages/GasStationConfig';
import SalesConfig from './pages/SalesConfig';
import ShiftDTEs from './pages/ShiftDTEs';
import GasDespachadores from './pages/GasDespachadores';
import GasDespachadorNozzles from './pages/GasDespachadorNozzles';
import GasPosTypes from './pages/GasPosTypes';
import GasAdvances from './pages/GasAdvances';
import GasTrupput from './pages/GasTrupput';
import ReporteVentasCombustible from './pages/ReporteVentasCombustible';
import GasCloseoutDetailReport from './pages/GasCloseoutDetailReport';
import FuelInventoryReport from './pages/FuelInventoryReport';
import GalonajeVendidoReport from './pages/GalonajeVendidoReport';
import GasRemesaDeliveries from './pages/GasRemesaDeliveries';
import SalesRemesaDeliveries from './pages/SalesRemesaDeliveries';
import GasAccumulatedDailyReport from './pages/GasAccumulatedDailyReport';
import FuelSalesSummaryReport from './pages/FuelSalesSummaryReport';

// Control de Pozo Pages
import PozoServicios from './pages/PozoServicios';
import PozoDespachos from './pages/PozoDespachos';
import PozoCorte from './pages/PozoCorte';
import PozoEntregasEfectivo from './pages/PozoEntregasEfectivo';

// RRHH Pages
import Afps from './pages/rh/Afps';
import Cargos from './pages/rh/Cargos';
import DescuentosProgramados from './pages/rh/DescuentosProgramados';
import Departamentos from './pages/rh/Departamentos';
import AfpTasas from './pages/rh/AfpTasas';
import IsssTasas from './pages/rh/IsssTasas';
import RentaConfig from './pages/rh/RentaConfig';
import AguinaldoConfig from './pages/rh/AguinaldoConfig';
import SalarioMinimo from './pages/rh/SalarioMinimo';
import TiposContrato from './pages/rh/TiposContrato';
import Empleados from './pages/rh/Empleados';
import Vacaciones from './pages/rh/Vacaciones';
import ConfigRh from './pages/rh/ConfigRh';
import Liquidaciones from './pages/rh/Liquidaciones';
import Honorarios from './pages/rh/Honorarios';
import Aguinaldos from './pages/rh/Aguinaldos';
import CuentasPlanillas from './pages/rh/CuentasPlanillas';
import Planillas from './pages/rh/Planillas';
import ReportesRh from './pages/rh/ReportesRh';
import AccionesPersonal from './pages/rh/AccionesPersonal';

import VatBookPurchases from './pages/VatBooks/VatBookPurchases';
import VatBookSalesTaxpayers from './pages/VatBooks/VatBookSalesTaxpayers';
import VatBookSalesConsumers from './pages/VatBooks/VatBookSalesConsumers';
import VatBookAnexosIVA from './pages/VatBooks/VatBookAnexosIVA';
import VatBookLiquidation from './pages/VatBooks/VatBookLiquidation';

// Egg Industrial Processing Pages
import EggDashboard from './pages/EggIndustrial/Dashboard';
import EggReception from './pages/EggIndustrial/Reception';
import EggProduction from './pages/EggIndustrial/Production';
import EggPackaging from './pages/EggIndustrial/Packaging';
import EggCostsMaintenance from './pages/EggIndustrial/CostsMaintenance';
import EggCosteoPorLibra from './pages/EggIndustrial/CosteoPorLibra';
import EggTraceability from './pages/EggIndustrial/Traceability';
import EggConfig from './pages/EggIndustrial/Config';
import EggProductionCalendar from './pages/EggIndustrial/ProductionCalendar';
import EggDispatch from './pages/EggIndustrial/EggDispatch';

// CRM Pages
import CustomerAgreements from './pages/CRM/CustomerAgreements';
import CrmConfig from './pages/CRM/CrmConfig';
import CrmQuotations from './pages/CRM/CrmQuotations';

import Layout from './components/layout/Layout';

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 1000 * 60 * 5, // 5 minutes
            gcTime: 1000 * 60 * 30,    // 30 minutes
            retry: (failureCount, error) => {
                if (error?.response?.status === 401) return false;
                return failureCount < 1;
            },
            refetchOnWindowFocus: false,
        },
    },
});

const ProtectedRoute = () => {
    const { user, loading } = useAuth();
    if (loading) return <div>Cargando...</div>;
    if (!user) return <Navigate to="/login" />;
    return <Layout />;
};

function App() {
  useEffect(() => {
    const preventNumberInputScroll = (e) => {
      if (document.activeElement && document.activeElement.type === 'number') {
        e.preventDefault();
        document.activeElement.blur();
      } else if (e.target && e.target.type === 'number') {
        e.preventDefault();
        e.target.blur();
      }
    };
    window.addEventListener('wheel', preventNumberInputScroll, { passive: false });
    return () => window.removeEventListener('wheel', preventNumberInputScroll);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
        <ConfirmProvider>
        <BrowserRouter>
            <AuthProvider>
                <Routes>
                    <Route path="/login" element={<Login />} />
                    <Route path="/dte" element={<PublicDTE />} />
                    <Route path="/scan/:token" element={<ScanInventory />} />
                    
                    {/* Protected Shell */}
                    <Route element={<ProtectedRoute />}>
                        <Route path="/dashboard" element={<Dashboard />} />
                        <Route path="/companies" element={<Companies />} />
                        <Route path="/branches" element={<Branches />} />
                        <Route path="/pos" element={<POS />} />
                        <Route path="/customers" element={<Customers />} />
                        <Route path="/products" element={<Products />} />
                        <Route path="/sellers" element={<Sellers />} />
                        <Route path="/users" element={<Users />} />
                        <Route path="/roles" element={<Roles />} />
                        <Route path="/providers" element={<Providers />} />
                        <Route path="/categories" element={<Categories />} />
                        <Route path="/user-access" element={<UserAccess />} />
                        <Route path="/configuracion/smtp" element={<SmtpConfig />} />
                        <Route path="/configuracion/sistema" element={<SystemSettings />} />
                        <Route path="/configuracion/logs" element={<LogViewer />} />
                        <Route path="/configuracion/notificaciones" element={<NotificacionesConfig />} />
                        <Route path="/configuracion/whatsapp" element={<WhatsAppConfig />} />
                        <Route path="/configuracion/modulos-empresa" element={<CompanyModules />} />
                        <Route path="/admin/menu-items" element={<MenuItems />} />
                        <Route path="/inventario/traslados" element={<Transfers />} />
                        <Route path="/inventario/movimientos" element={<InventoryAdjustments />} />
                        <Route path="/inventario/fisico" element={<PhysicalInventory />} />
                        <Route path="/inventario/kardex" element={<Kardex />} />
                        <Route path="/inventario/reportes/stock" element={<InventoryStockReport />} />
                        <Route path="/inventario/reportes/movimientos" element={<InventoryMovementsReport />} />
                        <Route path="/inventario/reportes/valorizacion" element={<InventoryValuationReport />} />
                        <Route path="/inventario/reportes/rotacion" element={<InventoryTurnoverReport />} />

                        {/* Libros de IVA */}
                        <Route path="/iva/compras" element={<VatBookPurchases />} />
                        <Route path="/iva/ventas-ccf" element={<VatBookSalesTaxpayers />} />
                        <Route path="/iva/ventas-fac" element={<VatBookSalesConsumers />} />
                        <Route path="/iva/anexos-iva" element={<VatBookAnexosIVA />} />
                        <Route path="/iva/liquidacion" element={<VatBookLiquidation />} />
                        

                        <Route path="/compras" element={<Purchases />} />
                        <Route path="/compras/gastos" element={<Expenses />} />
                        <Route path="/compras/reportes/compras" element={<PurchaseReport />} />
                        <Route path="/compras/reportes/gastos" element={<ExpenseReport />} />
                        <Route path="/compras/periodo" element={<PurchasePeriod />} />
                        <Route path="/compras/chq-contado" element={<PurchaseChecks />} />
                        <Route path="/compras/reportes/chq-contado" element={<PurchaseCheckReport />} />
                        <Route path="/compras/reportes/cheques-contado" element={<PurchaseCheckReport />} />
                        <Route path="/compras/quedan" element={<Quedan />} />
                        <Route path="/compras/reportes/quedan" element={<QuedanReport />} />
                        <Route path="/ventas/nueva" element={<SalesTerminal />} />
                        <Route path="/ventas/cierre" element={<CashClosing />} />
                        <Route path="/ventas/reportes/ventas" element={<SalesReport />} />
                        <Route path="/ventas/reportes/diarias" element={<DailySalesReport />} />
                        <Route path="/ventas/reportes/cliente" element={<SalesByCustomerReport />} />
                        <Route path="/ventas/reportes/categoria" element={<SalesByCategoryReport />} />
                        <Route path="/ventas/reportes/pos" element={<SalesByPOSReport />} />
                        <Route path="/ventas/reportes/detalle-facturacion" element={<SalesDetailReport />} />
                        <Route path="/ventas/reportes/arqueos" element={<ArqueosReport />} />
                        <Route path="/ventas/reportes/rentabilidad-tienda" element={<StoreProfitabilityReport />} />
                        <Route path="/ventas/combos" element={<Combos />} />
                        <Route path="/ventas/combustibles" element={<FuelPrices />} />
                        <Route path="/ventas/descuentos" element={<CustomerDiscounts />} />
                        <Route path="/ventas/reglas-descuento" element={<DiscountRules />} />
                        <Route path="/ventas/contingencia" element={<Contingency />} />
                        <Route path="/ventas/retorno" element={<Eret />} />
                        <Route path="/ventas/configuracion" element={<SalesConfig />} />
                        <Route path="/ventas/dtes-turno" element={<ShiftDTEs />} />
                        <Route path="/ventas" element={<SalesHistory />} />
                        <Route path="/seguridad/bitacora" element={<AuditLog />} />
                        <Route path="/seguridad/conectados" element={<ConnectedUsers />} />
                        <Route path="/seguridad/atajos" element={<KeyboardShortcuts />} />
                        <Route path="/changelog" element={<Changelog />} />
                        <Route path="/notificaciones" element={<NotificacionesLista />} />

                        {/* Accounts Receivable (CXC) */}
                        <Route path="/cxc/estado-cuenta" element={<CustomerStatement />} />
                        <Route path="/cxc/abonos" element={<AddPayment />} />
                        <Route path="/cxc/reportes/saldos" element={<CustomerBalancesReport />} />
                        <Route path="/cxc/reportes/documentos-pendientes" element={<PendingDocumentsDetailedReport />} />
                        <Route path="/cxc/reportes/estado-cuenta" element={<CustomerStatementReport />} />

                        {/* Accounts Payable (CXP) */}
                        <Route path="/cxp/estado-cuenta" element={<ProviderStatement />} />
                        <Route path="/cxp/abonos" element={<AddProviderPayment />} />
                        <Route path="/cxp/reportes/saldos" element={<ProviderBalancesReport />} />
                        <Route path="/cxp/reportes/documentos-pendientes" element={<ProviderPendingDocumentsDetailedReport />} />
                        
                        {/* Gas Station */}
                        <Route path="/gas-station/distributors" element={<GasDistributors />} />
                        <Route path="/gas-station/islands" element={<Islands />} />
                        <Route path="/gas-station/nozzles" element={<Nozzles />} />
                        <Route path="/gas-station/tanks" element={<Tanks />} />
                        <Route path="/gas-station/cierre-lecturas" element={<GasCloseout />} />
                        <Route path="/gas-station/pedidos" element={<GasOrders />} />
                        <Route path="/gas-station/historial-lecturas" element={<GasReadingHistory />} />
                        <Route path="/gas-station/expense-categories" element={<GasExpenseCategories />} />
                        <Route path="/gas-station/configuracion" element={<GasStationConfig />} />
                        <Route path="/gas-station/despachadores" element={<GasDespachadores />} />
                        <Route path="/gas-station/despachador-nozzles" element={<GasDespachadorNozzles />} />
                        <Route path="/gas-station/pos-tipos" element={<GasPosTypes />} />
                        <Route path="/gas-station/anticipos" element={<GasAdvances />} />
                        <Route path="/gas-station/trupput" element={<GasTrupput />} />
                        <Route path="/gas-station/entrega-remesas" element={<GasRemesaDeliveries />} />
                        <Route path="/ventas/entrega-remesas" element={<SalesRemesaDeliveries />} />
                        <Route path="/gas-station/reporte-ventas" element={<ReporteVentasCombustible />} />
                        <Route path="/gas-station/reporte-detalle-cierre" element={<GasCloseoutDetailReport />} />
                        <Route path="/gas-station/reporte-inventario-combustible" element={<FuelInventoryReport />} />
                        <Route path="/gas-station/galonaje-vendido" element={<GalonajeVendidoReport />} />
                        <Route path="/gas-station/reporte-acumulado-diario" element={<GasAccumulatedDailyReport />} />
                        <Route path="/gas-station/reporte-resumen-gln-vendidos" element={<FuelSalesSummaryReport />} />

                        {/* Control de Pozo */}
                        <Route path="/pozo/servicios" element={<PozoServicios />} />
                        <Route path="/pozo/despachos" element={<PozoDespachos />} />
                        <Route path="/pozo/corte" element={<PozoCorte />} />
                        <Route path="/pozo/entregas-efectivo" element={<PozoEntregasEfectivo />} />

                        {/* RRHH */}
                        <Route path="/rh/afps" element={<Afps />} />
                        <Route path="/rh/cargos" element={<Cargos />} />
                        <Route path="/rh/descuentos-programados" element={<DescuentosProgramados />} />
                        <Route path="/rh/departamentos" element={<Departamentos />} />
                        <Route path="/rh/afp-tasas" element={<AfpTasas />} />
                        <Route path="/rh/isss-tasas" element={<IsssTasas />} />
                        <Route path="/rh/renta-config" element={<RentaConfig />} />
                        <Route path="/rh/aguinaldo-config" element={<AguinaldoConfig />} />
                        <Route path="/rh/salario-minimo" element={<SalarioMinimo />} />
                        <Route path="/rh/tipos-contrato" element={<TiposContrato />} />
                        <Route path="/rh/empleados" element={<Empleados />} />
                        <Route path="/rh/planilla-vacaciones" element={<Vacaciones />} />
                        <Route path="/rh/config-rh" element={<ConfigRh />} />
                        <Route path="/rh/liquidaciones" element={<Liquidaciones />} />
                        <Route path="/rh/honorarios" element={<Honorarios />} />
                        <Route path="/rh/aguinaldos" element={<Aguinaldos />} />
                        <Route path="/rh/cuentas-planillas" element={<CuentasPlanillas />} />
                        <Route path="/rh/planillas" element={<Planillas />} />
                        <Route path="/rh/acciones-personal" element={<AccionesPersonal />} />
                        <Route path="/rh/reportes" element={<Navigate to="/rh/reportes/isss" replace />} />
<Route path="/rh/reportes/:tipo" element={<ReportesRh />} />

                        {/* Contabilidad */}
                        <Route path="/contabilidad/cuentas" element={<ChartOfAccounts />} />
                        <Route path="/contabilidad/partidas" element={<AccountingEntries />} />
                        <Route path="/contabilidad/contabilizar" element={<AccountingGenerate kinds={['ventas', 'compras']} />} />
                        <Route path="/contabilidad/contabilizar/cxc-cxp" element={<AccountingGenerate kinds={['cxc', 'cxp']} />} />
                        <Route path="/contabilidad/correlativos" element={<AccountingCorrelativos />} />
                        <Route path="/contabilidad/cierre" element={<YearClosing />} />
                        <Route path="/contabilidad/apertura" element={<YearOpening />} />
                        <Route path="/contabilidad/ajustes" element={<AccountingSettings />} />
                        <Route path="/contabilidad/reportes/libro-diario" element={<LibroDiario />} />
                        <Route path="/contabilidad/reportes/libro-diario-mayor" element={<LibroDiarioMayor />} />
                        <Route path="/contabilidad/reportes/libro-mayor" element={<LibroMayor />} />
                        <Route path="/contabilidad/reportes/balance-comprobacion" element={<BalanceComprobacion />} />
                        <Route path="/contabilidad/reportes/estado-resultados" element={<EstadoResultados />} />
                        <Route path="/contabilidad/reportes/balance-general" element={<BalanceGeneral />} />
                        <Route path="/contabilidad/reportes/anexo-balance" element={<AnexoBalance />} />
                        <Route path="/contabilidad/reportes/balance-comparativo" element={<BalanceComparativo />} />
                        <Route path="/contabilidad/reportes/cambios-patrimonio" element={<CambiosPatrimonio />} />
                        <Route path="/contabilidad/reportes/flujo-efectivo" element={<FlujoEfectivo />} />
                        <Route path="/contabilidad/reportes/auxiliar-operaciones" element={<AuxiliarOperaciones />} />
                        <Route path="/contabilidad/reportes/listado-partidas" element={<ListadoPartidas />} />
                        <Route path="/contabilidad/reportes/cedula-auditoria" element={<CedulaAuditoria />} />
                        <Route path="/contabilidad/reportes/retenciones" element={<Retenciones />} />

                        {/* Huevo Industrial / Ovoproductos (ANDELSA) */}
                        <Route path="/industrial/planta" element={<EggDashboard />} />
                        <Route path="/industrial/recepcion" element={<EggReception />} />
                        <Route path="/industrial/produccion" element={<EggProduction />} />
                        <Route path="/industrial/calendario" element={<EggProductionCalendar />} />
                        <Route path="/industrial/despachos" element={<EggDispatch />} />
                        <Route path="/industrial/empaque" element={<EggPackaging />} />
                        <Route path="/industrial/costos-mantenimiento" element={<EggCostsMaintenance />} />
                        <Route path="/industrial/costeo-libra" element={<EggCosteoPorLibra />} />
                        <Route path="/industrial/trazabilidad" element={<EggTraceability />} />
                        <Route path="/industrial/configuracion" element={<EggConfig />} />

                        {/* CRM Comercial */}
                        <Route path="/crm/cotizaciones" element={<CrmQuotations />} />
                        <Route path="/crm/acuerdos" element={<CustomerAgreements />} />
                        <Route path="/crm/configuracion" element={<CrmConfig />} />
                        
                        <Route path="/" element={<Navigate to="/dashboard" replace />} />
                    </Route>

                    <Route path="*" element={<Navigate to="/dashboard" replace />} />
                </Routes>
                <Toaster richColors position="top-right" offset={{ top: 76, right: 24 }} expand visibleToasts={5} duration={4000} />
            </AuthProvider>
        </BrowserRouter>
        </ConfirmProvider>
    </QueryClientProvider>
  )
}

export default App
