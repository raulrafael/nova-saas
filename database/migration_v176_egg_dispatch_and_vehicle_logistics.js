const pool = require('../server/src/config/db');

async function runMigration() {
    try {
        console.log('Running migration v176 - Egg Industrial Dispatch, Vehicle Fleet & Maintenance...');

        // 1. Modificar tabla customer_branches para geolocalización y contacto de entrega
        console.log('Verificando columnas en customer_branches...');
        const [branchCols] = await pool.query('DESCRIBE customer_branches');
        const branchColNames = branchCols.map(c => c.Field);

        if (!branchColNames.includes('latitude')) {
            await pool.query('ALTER TABLE customer_branches ADD COLUMN latitude DECIMAL(10, 8) NULL AFTER direccion');
            console.log('✓ Columna latitude agregada a customer_branches.');
        }

        if (!branchColNames.includes('longitude')) {
            await pool.query('ALTER TABLE customer_branches ADD COLUMN longitude DECIMAL(11, 8) NULL AFTER latitude');
            console.log('✓ Columna longitude agregada a customer_branches.');
        }

        if (!branchColNames.includes('contacto_nombre')) {
            await pool.query('ALTER TABLE customer_branches ADD COLUMN contacto_nombre VARCHAR(150) NULL AFTER telefono');
            console.log('✓ Columna contacto_nombre agregada a customer_branches.');
        }

        if (!branchColNames.includes('contacto_telefono')) {
            await pool.query('ALTER TABLE customer_branches ADD COLUMN contacto_telefono VARCHAR(50) NULL AFTER contacto_nombre');
            console.log('✓ Columna contacto_telefono agregada a customer_branches.');
        }

        if (!branchColNames.includes('indicaciones_entrega')) {
            await pool.query('ALTER TABLE customer_branches ADD COLUMN indicaciones_entrega TEXT NULL AFTER contacto_telefono');
            console.log('✓ Columna indicaciones_entrega agregada a customer_branches.');
        }

        // 2. Modificar tabla egg_customer_orders
        console.log('Verificando columnas en egg_customer_orders...');
        const [orderCols] = await pool.query('DESCRIBE egg_customer_orders');
        const orderColNames = orderCols.map(c => c.Field);

        if (!orderColNames.includes('customer_branch_id')) {
            await pool.query('ALTER TABLE egg_customer_orders ADD COLUMN customer_branch_id INT NULL AFTER customer_id');
            console.log('✓ Columna customer_branch_id agregada a egg_customer_orders.');
        }

        if (!orderColNames.includes('priority')) {
            await pool.query("ALTER TABLE egg_customer_orders ADD COLUMN priority ENUM('normal', 'alta', 'urgente') NOT NULL DEFAULT 'normal' AFTER status");
            console.log('✓ Columna priority agregada a egg_customer_orders.');
        }

        if (!orderColNames.includes('dispatch_route_id')) {
            await pool.query('ALTER TABLE egg_customer_orders ADD COLUMN dispatch_route_id INT NULL AFTER priority');
            console.log('✓ Columna dispatch_route_id agregada a egg_customer_orders.');
        }

        if (!orderColNames.includes('delivery_status')) {
            await pool.query("ALTER TABLE egg_customer_orders ADD COLUMN delivery_status ENUM('pendiente', 'en_ruta', 'entregado', 'no_entregado', 'reprogramado') NOT NULL DEFAULT 'pendiente' AFTER dispatch_route_id");
            console.log('✓ Columna delivery_status agregada a egg_customer_orders.');
        }

        if (!orderColNames.includes('delivered_at')) {
            await pool.query('ALTER TABLE egg_customer_orders ADD COLUMN delivered_at DATETIME NULL AFTER delivery_status');
            console.log('✓ Columna delivered_at agregada a egg_customer_orders.');
        }

        if (!orderColNames.includes('delivered_by_user_id')) {
            await pool.query('ALTER TABLE egg_customer_orders ADD COLUMN delivered_by_user_id INT NULL AFTER delivered_at');
            console.log('✓ Columna delivered_by_user_id agregada a egg_customer_orders.');
        }

        if (!orderColNames.includes('dte_codigo_generacion')) {
            await pool.query('ALTER TABLE egg_customer_orders ADD COLUMN dte_codigo_generacion VARCHAR(100) NULL AFTER delivered_by_user_id');
            console.log('✓ Columna dte_codigo_generacion agregada a egg_customer_orders.');
        }

        if (!orderColNames.includes('recipient_name')) {
            await pool.query('ALTER TABLE egg_customer_orders ADD COLUMN recipient_name VARCHAR(150) NULL AFTER dte_codigo_generacion');
            console.log('✓ Columna recipient_name agregada a egg_customer_orders.');
        }

        if (!orderColNames.includes('recipient_phone')) {
            await pool.query('ALTER TABLE egg_customer_orders ADD COLUMN recipient_phone VARCHAR(50) NULL AFTER recipient_name');
            console.log('✓ Columna recipient_phone agregada a egg_customer_orders.');
        }

        if (!orderColNames.includes('delivery_notes')) {
            await pool.query('ALTER TABLE egg_customer_orders ADD COLUMN delivery_notes TEXT NULL AFTER recipient_phone');
            console.log('✓ Columna delivery_notes agregada a egg_customer_orders.');
        }

        // 3. Crear tabla delivery_vehicles
        console.log('Creando tabla delivery_vehicles...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS delivery_vehicles (
                id INT AUTO_INCREMENT PRIMARY KEY,
                company_id INT NOT NULL,
                codigo VARCHAR(50) NOT NULL,
                placa VARCHAR(20) NOT NULL,
                marca VARCHAR(50) NULL,
                modelo VARCHAR(50) NULL,
                anio INT NULL,
                tipo_vehiculo ENUM('camion_refrigerado', 'camion_seco', 'panel', 'pickup', 'otro') NOT NULL DEFAULT 'camion_refrigerado',
                capacidad_peso_lbs DECIMAL(10,2) NOT NULL DEFAULT 10000.00,
                capacidad_cubetas INT NOT NULL DEFAULT 350,
                tiene_termo_king TINYINT(1) NOT NULL DEFAULT 1,
                odometro_actual DECIMAL(10,1) NOT NULL DEFAULT 0.0,
                estado ENUM('disponible', 'en_ruta', 'en_mantenimiento', 'inactivo') NOT NULL DEFAULT 'disponible',
                ultimo_mantenimiento_fecha DATE NULL,
                ultimo_mantenimiento_km DECIMAL(10,1) NULL,
                proximo_mantenimiento_fecha DATE NULL,
                proximo_mantenimiento_km DECIMAL(10,1) NULL,
                notas TEXT NULL,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_dv_comp (company_id),
                INDEX idx_dv_estado (company_id, estado),
                INDEX idx_dv_placa (company_id, placa)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
        console.log('✓ Tabla delivery_vehicles creada o verificada.');

        // 4. Crear tabla vehicle_maintenance_logs
        console.log('Creando tabla vehicle_maintenance_logs...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS vehicle_maintenance_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                company_id INT NOT NULL,
                vehicle_id INT NOT NULL,
                tipo_mantenimiento ENUM('preventivo', 'correctivo', 'termo_king', 'llantas', 'frenos', 'inspeccion', 'otro') NOT NULL DEFAULT 'preventivo',
                fecha_programada DATE NOT NULL,
                fecha_realizada DATE NULL,
                odometro DECIMAL(10,1) NULL,
                taller_proveedor VARCHAR(150) NULL,
                costo_total DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                descripcion TEXT NOT NULL,
                repuestos_cambiados TEXT NULL,
                estado ENUM('programado', 'en_proceso', 'completado', 'cancelado') NOT NULL DEFAULT 'programado',
                proximo_servicio_km DECIMAL(10,1) NULL,
                proximo_servicio_fecha DATE NULL,
                responsable_usuario_id INT NULL,
                notas TEXT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_vml_comp_veh (company_id, vehicle_id),
                INDEX idx_vml_fecha (fecha_programada),
                INDEX idx_vml_estado (estado),
                CONSTRAINT fk_vml_vehicle FOREIGN KEY (vehicle_id) REFERENCES delivery_vehicles(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
        console.log('✓ Tabla vehicle_maintenance_logs creada o verificada.');

        // 5. Crear tabla egg_dispatch_routes
        console.log('Creando tabla egg_dispatch_routes...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS egg_dispatch_routes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                company_id INT NOT NULL,
                codigo_ruta VARCHAR(50) NOT NULL,
                fecha_despacho DATE NOT NULL,
                vehicle_id INT NULL,
                driver_id INT NULL,
                driver_name VARCHAR(150) NULL,
                driver_phone VARCHAR(50) NULL,
                estado ENUM('borrador', 'planificada', 'en_curso', 'completada', 'cancelada') NOT NULL DEFAULT 'planificada',
                hora_salida_estimada TIME NULL DEFAULT '07:00:00',
                hora_salida_real DATETIME NULL,
                hora_llegada_real DATETIME NULL,
                total_pedidos INT NOT NULL DEFAULT 0,
                total_peso_lbs DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                total_cubetas INT NOT NULL DEFAULT 0,
                odometro_inicial DECIMAL(10,1) NULL,
                odometro_final DECIMAL(10,1) NULL,
                distancia_km_estimada DECIMAL(10,2) NULL,
                notas_ruta TEXT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_edr_comp_fecha (company_id, fecha_despacho),
                INDEX idx_edr_estado (company_id, estado),
                INDEX idx_edr_driver (company_id, driver_id),
                CONSTRAINT fk_edr_vehicle FOREIGN KEY (vehicle_id) REFERENCES delivery_vehicles(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
        console.log('✓ Tabla egg_dispatch_routes creada o verificada.');

        // 6. Crear tabla egg_dispatch_stops
        console.log('Creando tabla egg_dispatch_stops...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS egg_dispatch_stops (
                id INT AUTO_INCREMENT PRIMARY KEY,
                dispatch_route_id INT NOT NULL,
                order_id INT NOT NULL,
                customer_id INT NOT NULL,
                customer_branch_id INT NULL,
                orden_visita INT NOT NULL DEFAULT 1,
                prioridad ENUM('normal', 'alta', 'urgente') NOT NULL DEFAULT 'normal',
                hora_estimada_llegada TIME NULL,
                hora_real_llegada DATETIME NULL,
                estado_entrega ENUM('pendiente', 'en_camino', 'entregado', 'no_entregado', 'reprogramado') NOT NULL DEFAULT 'pendiente',
                dte_codigo_generacion VARCHAR(100) NULL,
                recibido_por VARCHAR(150) NULL,
                telefono_receptor VARCHAR(50) NULL,
                observaciones_entrega TEXT NULL,
                lat_entrega DECIMAL(10,8) NULL,
                lng_entrega DECIMAL(11,8) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_eds_route (dispatch_route_id),
                INDEX idx_eds_order (order_id),
                INDEX idx_eds_cust (customer_id),
                CONSTRAINT fk_eds_route FOREIGN KEY (dispatch_route_id) REFERENCES egg_dispatch_routes(id) ON DELETE CASCADE,
                CONSTRAINT fk_eds_order FOREIGN KEY (order_id) REFERENCES egg_customer_orders(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
        console.log('✓ Tabla egg_dispatch_stops creada o verificada.');

        // 7. Sembrar vehículos iniciales de muestra si la tabla está vacía para la empresa de ovoproductos (company_id = 9 o activas)
        const [existingVehicles] = await pool.query('SELECT COUNT(*) as count FROM delivery_vehicles');
        if (existingVehicles[0].count === 0) {
            const [companies] = await pool.query('SELECT id FROM companies WHERE id = 9 OR razon_social LIKE "%ANDELSA%" LIMIT 1');
            const compId = companies.length > 0 ? companies[0].id : 9;

            await pool.query(`
                INSERT INTO delivery_vehicles (company_id, codigo, placa, marca, modelo, anio, tipo_vehiculo, capacidad_peso_lbs, capacidad_cubetas, tiene_termo_king, odometro_actual, estado, notas)
                VALUES 
                (?, 'CAM-01', 'C-104928', 'Hino', '300 Serie 816 Refrigerado', 2022, 'camion_refrigerado', 11000.00, 360, 1, 42350.0, 'disponible', 'Furgón isotérmico Thermo King V-500 MAX. Capacidad para 360 cubetas a 2-4°C.'),
                (?, 'CAM-02', 'C-112845', 'Isuzu', 'NPR 75L Refrigerado', 2021, 'camion_refrigerado', 10000.00, 330, 1, 68900.0, 'disponible', 'Thermo King V-300. Rutas metropolitanas y panaderías.'),
                (?, 'PAN-01', 'P-892110', 'Toyota', 'HiAce Panel Refrigerada', 2023, 'panel', 3500.00, 110, 1, 18200.0, 'disponible', 'Entregas express y pedidos pequeños urgentes.')
            `, [compId, compId, compId]);
            console.log('✓ Camiones de flota iniciales sembrados.');
        }

        // 8. Registrar menú si no existe
        const [parentMenu] = await pool.query("SELECT id FROM menu_items WHERE path = '/industrial/planta' OR label LIKE '%Huevo Industrial%' LIMIT 1");
        const parentId = parentMenu.length > 0 ? parentMenu[0].id : 67;

        const [existingMenu] = await pool.query("SELECT id FROM menu_items WHERE path = '/industrial/despachos'");
        if (existingMenu.length === 0) {
            await pool.query(`
                INSERT INTO menu_items (label, path, icon, parent_id, permission_key, hide_in_menu, sort_order, is_active)
                VALUES ('Despachos y Rutas', '/industrial/despachos', 'Truck', ?, 'manage_production', 0, 4, 1)
            `, [parentId]);
            console.log('✓ Menú Despachos y Rutas registrado en menu_items.');
        }

        console.log('Migration v176 completed successfully!');
    } catch (error) {
        console.error('Error during migration v176:', error);
        throw error;
    }
}

module.exports = runMigration;
