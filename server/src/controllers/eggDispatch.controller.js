const pool = require('../config/db');

/**
 * ==============================================================================
 * CONTROLADOR DE DESPACHOS, RUTAS, FLOTA Y MANTENIMIENTO (HUEVO INDUSTRIAL)
 * ==============================================================================
 */

// ==========================================
// 1. GESTIÓN DE VEHÍCULOS DE REPARTO
// ==========================================

const getVehicles = async (req, res) => {
    try {
        const company_id = req.company_id || req.user?.company_id;
        const { estado, activo } = req.query;

        let sql = `
            SELECT v.*,
                   (SELECT COUNT(*) 
                    FROM vehicle_maintenance_logs m 
                    WHERE m.vehicle_id = v.id AND m.estado = 'programado') AS mantenimientos_pendientes,
                   (SELECT COUNT(*) 
                    FROM egg_dispatch_routes r 
                    WHERE r.vehicle_id = v.id AND r.estado = 'en_curso') AS rutas_activas
            FROM delivery_vehicles v
            WHERE v.company_id = ?
        `;
        const params = [company_id];

        if (activo !== undefined && activo !== '') {
            sql += ' AND v.is_active = ?';
            params.push(activo === 'true' || activo === '1' ? 1 : 0);
        } else {
            sql += ' AND v.is_active = 1';
        }

        if (estado) {
            sql += ' AND v.estado = ?';
            params.push(estado);
        }

        sql += ' ORDER BY v.codigo ASC, v.placa ASC';

        const [vehicles] = await pool.query(sql, params);
        res.json(vehicles);
    } catch (error) {
        console.error('Error al obtener vehículos:', error);
        res.status(500).json({ message: error.message });
    }
};

const saveVehicle = async (req, res) => {
    try {
        const company_id = req.company_id || req.user?.company_id;
        const { id } = req.params;
        const {
            codigo,
            placa,
            marca,
            modelo,
            anio,
            tipo_vehiculo,
            capacidad_peso_lbs,
            capacidad_cubetas,
            tiene_termo_king,
            odometro_actual,
            estado,
            ultimo_mantenimiento_fecha,
            ultimo_mantenimiento_km,
            proximo_mantenimiento_fecha,
            proximo_mantenimiento_km,
            notas,
            is_active
        } = req.body;

        if (!codigo || !placa) {
            return res.status(400).json({ message: 'El código del vehículo y la placa son obligatorios.' });
        }

        // Validar placa única dentro de la empresa
        let checkSql = 'SELECT id FROM delivery_vehicles WHERE company_id = ? AND placa = ?';
        const checkParams = [company_id, placa.trim()];
        if (id) {
            checkSql += ' AND id != ?';
            checkParams.push(id);
        }
        const [dup] = await pool.query(checkSql, checkParams);
        if (dup.length > 0) {
            return res.status(400).json({ message: `Ya existe un vehículo registrado con la placa ${placa}.` });
        }

        if (id) {
            await pool.query(
                `UPDATE delivery_vehicles SET
                    codigo = ?, placa = ?, marca = ?, modelo = ?, anio = ?,
                    tipo_vehiculo = ?, capacidad_peso_lbs = ?, capacidad_cubetas = ?,
                    tiene_termo_king = ?, odometro_actual = ?, estado = ?,
                    ultimo_mantenimiento_fecha = ?, ultimo_mantenimiento_km = ?,
                    proximo_mantenimiento_fecha = ?, proximo_mantenimiento_km = ?,
                    notas = ?, is_active = ?
                 WHERE id = ? AND company_id = ?`,
                [
                    codigo.trim().toUpperCase(),
                    placa.trim().toUpperCase(),
                    marca || null,
                    modelo || null,
                    parseInt(anio) || null,
                    tipo_vehiculo || 'camion_refrigerado',
                    parseFloat(capacidad_peso_lbs) || 10000.0,
                    parseInt(capacidad_cubetas) || 350,
                    tiene_termo_king ? 1 : 0,
                    parseFloat(odometro_actual) || 0,
                    estado || 'disponible',
                    ultimo_mantenimiento_fecha || null,
                    ultimo_mantenimiento_km ? parseFloat(ultimo_mantenimiento_km) : null,
                    proximo_mantenimiento_fecha || null,
                    proximo_mantenimiento_km ? parseFloat(proximo_mantenimiento_km) : null,
                    notas || null,
                    is_active !== undefined ? (is_active ? 1 : 0) : 1,
                    id,
                    company_id
                ]
            );
            res.json({ id, message: 'Vehículo actualizado exitosamente.' });
        } else {
            const [result] = await pool.query(
                `INSERT INTO delivery_vehicles (
                    company_id, codigo, placa, marca, modelo, anio, tipo_vehiculo,
                    capacidad_peso_lbs, capacidad_cubetas, tiene_termo_king, odometro_actual,
                    estado, ultimo_mantenimiento_fecha, ultimo_mantenimiento_km,
                    proximo_mantenimiento_fecha, proximo_mantenimiento_km, notas, is_active
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    company_id,
                    codigo.trim().toUpperCase(),
                    placa.trim().toUpperCase(),
                    marca || null,
                    modelo || null,
                    parseInt(anio) || null,
                    tipo_vehiculo || 'camion_refrigerado',
                    parseFloat(capacidad_peso_lbs) || 10000.0,
                    parseInt(capacidad_cubetas) || 350,
                    tiene_termo_king ? 1 : 0,
                    parseFloat(odometro_actual) || 0,
                    estado || 'disponible',
                    ultimo_mantenimiento_fecha || null,
                    ultimo_mantenimiento_km ? parseFloat(ultimo_mantenimiento_km) : null,
                    proximo_mantenimiento_fecha || null,
                    proximo_mantenimiento_km ? parseFloat(proximo_mantenimiento_km) : null,
                    notas || null,
                    is_active !== undefined ? (is_active ? 1 : 0) : 1
                ]
            );
            res.status(201).json({ id: result.insertId, message: 'Vehículo registrado exitosamente.' });
        }
    } catch (error) {
        console.error('Error al guardar vehículo:', error);
        res.status(500).json({ message: error.message });
    }
};

const deleteVehicle = async (req, res) => {
    try {
        const { id } = req.params;
        const company_id = req.company_id || req.user?.company_id;

        // Desactivación lógica segura
        await pool.query(
            'UPDATE delivery_vehicles SET is_active = 0, estado = "inactivo" WHERE id = ? AND company_id = ?',
            [id, company_id]
        );
        res.json({ message: 'Vehículo inactivado exitosamente.' });
    } catch (error) {
        console.error('Error al eliminar vehículo:', error);
        res.status(500).json({ message: error.message });
    }
};

// ==========================================
// 2. MANTENIMIENTO DE VEHÍCULOS
// ==========================================

const getMaintenanceLogs = async (req, res) => {
    try {
        const company_id = req.company_id || req.user?.company_id;
        const { vehicle_id, estado, fecha_desde, fecha_hasta } = req.query;

        let sql = `
            SELECT m.*,
                   v.codigo AS vehicle_codigo,
                   v.placa AS vehicle_placa,
                   v.marca AS vehicle_marca,
                   v.modelo AS vehicle_modelo,
                   v.odometro_actual AS vehicle_odometro_actual,
                   u.nombre AS responsable_nombre
            FROM vehicle_maintenance_logs m
            JOIN delivery_vehicles v ON m.vehicle_id = v.id
            LEFT JOIN users u ON m.responsable_usuario_id = u.id
            WHERE m.company_id = ?
        `;
        const params = [company_id];

        if (vehicle_id) {
            sql += ' AND m.vehicle_id = ?';
            params.push(vehicle_id);
        }

        if (estado) {
            sql += ' AND m.estado = ?';
            params.push(estado);
        }

        if (fecha_desde) {
            sql += ' AND m.fecha_programada >= ?';
            params.push(fecha_desde);
        }

        if (fecha_hasta) {
            sql += ' AND m.fecha_programada <= ?';
            params.push(fecha_hasta);
        }

        sql += ' ORDER BY m.fecha_programada DESC, m.id DESC';

        const [logs] = await pool.query(sql, params);
        res.json(logs);
    } catch (error) {
        console.error('Error al obtener mantenimientos:', error);
        res.status(500).json({ message: error.message });
    }
};

const saveMaintenanceLog = async (req, res) => {
    try {
        const company_id = req.company_id || req.user?.company_id;
        const { id } = req.params;
        const {
            vehicle_id,
            tipo_mantenimiento,
            fecha_programada,
            fecha_realizada,
            odometro,
            taller_proveedor,
            costo_total,
            descripcion,
            repuestos_cambiados,
            estado,
            proximo_servicio_km,
            proximo_servicio_fecha,
            responsable_usuario_id,
            notas
        } = req.body;

        if (!vehicle_id || !fecha_programada || !descripcion) {
            return res.status(400).json({ message: 'Vehículo, fecha programada y descripción son obligatorios.' });
        }

        let maintenanceId = id;

        if (id) {
            await pool.query(
                `UPDATE vehicle_maintenance_logs SET
                    vehicle_id = ?, tipo_mantenimiento = ?, fecha_programada = ?,
                    fecha_realizada = ?, odometro = ?, taller_proveedor = ?,
                    costo_total = ?, descripcion = ?, repuestos_cambiados = ?,
                    estado = ?, proximo_servicio_km = ?, proximo_servicio_fecha = ?,
                    responsable_usuario_id = ?, notas = ?
                 WHERE id = ? AND company_id = ?`,
                [
                    vehicle_id,
                    tipo_mantenimiento || 'preventivo',
                    fecha_programada,
                    fecha_realizada || null,
                    odometro ? parseFloat(odometro) : null,
                    taller_proveedor || null,
                    parseFloat(costo_total) || 0.0,
                    descripcion,
                    repuestos_cambiados || null,
                    estado || 'programado',
                    proximo_servicio_km ? parseFloat(proximo_servicio_km) : null,
                    proximo_servicio_fecha || null,
                    responsable_usuario_id ? parseInt(responsable_usuario_id) : (req.user?.id || null),
                    notas || null,
                    id,
                    company_id
                ]
            );
        } else {
            const [result] = await pool.query(
                `INSERT INTO vehicle_maintenance_logs (
                    company_id, vehicle_id, tipo_mantenimiento, fecha_programada,
                    fecha_realizada, odometro, taller_proveedor, costo_total,
                    descripcion, repuestos_cambiados, estado, proximo_servicio_km,
                    proximo_servicio_fecha, responsable_usuario_id, notas
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    company_id,
                    vehicle_id,
                    tipo_mantenimiento || 'preventivo',
                    fecha_programada,
                    fecha_realizada || null,
                    odometro ? parseFloat(odometro) : null,
                    taller_proveedor || null,
                    parseFloat(costo_total) || 0.0,
                    descripcion,
                    repuestos_cambiados || null,
                    estado || 'programado',
                    proximo_servicio_km ? parseFloat(proximo_servicio_km) : null,
                    proximo_servicio_fecha || null,
                    responsable_usuario_id ? parseInt(responsable_usuario_id) : (req.user?.id || null),
                    notas || null
                ]
            );
            maintenanceId = result.insertId;
        }

        // Sincronizar estado del vehículo según el mantenimiento
        if (estado === 'en_proceso') {
            await pool.query(
                'UPDATE delivery_vehicles SET estado = "en_mantenimiento" WHERE id = ? AND company_id = ?',
                [vehicle_id, company_id]
            );
        } else if (estado === 'completado') {
            let vehicleUpdates = ['estado = "disponible"'];
            let vParams = [];

            if (fecha_realizada) {
                vehicleUpdates.push('ultimo_mantenimiento_fecha = ?');
                vParams.push(fecha_realizada);
            }
            if (odometro) {
                vehicleUpdates.push('ultimo_mantenimiento_km = ?');
                vParams.push(parseFloat(odometro));
                vehicleUpdates.push('odometro_actual = GREATEST(odometro_actual, ?)');
                vParams.push(parseFloat(odometro));
            }
            if (proximo_servicio_fecha) {
                vehicleUpdates.push('proximo_mantenimiento_fecha = ?');
                vParams.push(proximo_servicio_fecha);
            }
            if (proximo_servicio_km) {
                vehicleUpdates.push('proximo_mantenimiento_km = ?');
                vParams.push(parseFloat(proximo_servicio_km));
            }

            vParams.push(vehicle_id, company_id);
            await pool.query(
                `UPDATE delivery_vehicles SET ${vehicleUpdates.join(', ')} WHERE id = ? AND company_id = ?`,
                vParams
            );
        }

        res.json({ id: maintenanceId, message: 'Registro de mantenimiento guardado exitosamente.' });
    } catch (error) {
        console.error('Error al guardar mantenimiento:', error);
        res.status(500).json({ message: error.message });
    }
};

const deleteMaintenanceLog = async (req, res) => {
    try {
        const { id } = req.params;
        const company_id = req.company_id || req.user?.company_id;

        await pool.query('DELETE FROM vehicle_maintenance_logs WHERE id = ? AND company_id = ?', [id, company_id]);
        res.json({ message: 'Mantenimiento eliminado correctamente.' });
    } catch (error) {
        console.error('Error al eliminar mantenimiento:', error);
        res.status(500).json({ message: error.message });
    }
};

// ==========================================
// 3. RUTAS DE DESPACHO Y PARADAS
// ==========================================

const getDispatchRoutes = async (req, res) => {
    try {
        const company_id = req.company_id || req.user?.company_id;
        const { fecha_desde, fecha_hasta, fecha, estado, driver_id, vehicle_id } = req.query;

        let sql = `
            SELECT r.*,
                   v.codigo AS vehicle_codigo,
                   v.placa AS vehicle_placa,
                   v.capacidad_peso_lbs AS vehicle_capacidad_peso,
                   v.capacidad_cubetas AS vehicle_capacidad_cubetas,
                   v.tiene_termo_king AS vehicle_termo_king,
                   v.estado AS vehicle_estado,
                   u.nombre AS driver_user_nombre,
                   (SELECT COUNT(*) FROM egg_dispatch_stops s WHERE s.dispatch_route_id = r.id) AS total_stops,
                   (SELECT COUNT(*) FROM egg_dispatch_stops s WHERE s.dispatch_route_id = r.id AND s.estado_entrega = 'entregado') AS completed_stops,
                   (SELECT COUNT(*) FROM egg_dispatch_stops s WHERE s.dispatch_route_id = r.id AND s.prioridad = 'urgente' AND s.estado_entrega != 'entregado') AS urgent_pending_stops
            FROM egg_dispatch_routes r
            LEFT JOIN delivery_vehicles v ON r.vehicle_id = v.id
            LEFT JOIN users u ON r.driver_id = u.id
            WHERE r.company_id = ?
        `;
        const params = [company_id];

        if (fecha) {
            sql += ' AND r.fecha_despacho = ?';
            params.push(fecha);
        } else {
            if (fecha_desde) {
                sql += ' AND r.fecha_despacho >= ?';
                params.push(fecha_desde);
            }
            if (fecha_hasta) {
                sql += ' AND r.fecha_despacho <= ?';
                params.push(fecha_hasta);
            }
        }

        if (estado) {
            sql += ' AND r.estado = ?';
            params.push(estado);
        }

        if (driver_id) {
            sql += ' AND r.driver_id = ?';
            params.push(driver_id);
        }

        if (vehicle_id) {
            sql += ' AND r.vehicle_id = ?';
            params.push(vehicle_id);
        }

        sql += ' ORDER BY r.fecha_despacho DESC, r.hora_salida_estimada ASC, r.id DESC';

        const [routes] = await pool.query(sql, params);
        res.json(routes);
    } catch (error) {
        console.error('Error al listar rutas de despacho:', error);
        res.status(500).json({ message: error.message });
    }
};

const getDispatchRouteDetail = async (req, res) => {
    try {
        const { id } = req.params;
        const company_id = req.company_id || req.user?.company_id;

        const [routeRows] = await pool.query(
            `SELECT r.*,
                    v.codigo AS vehicle_codigo,
                    v.placa AS vehicle_placa,
                    v.marca AS vehicle_marca,
                    v.modelo AS vehicle_modelo,
                    v.capacidad_peso_lbs AS vehicle_capacidad_peso,
                    v.capacidad_cubetas AS vehicle_capacidad_cubetas,
                    v.tiene_termo_king,
                    v.odometro_actual,
                    v.estado AS vehicle_estado,
                    u.nombre AS driver_user_nombre,
                    u.username AS driver_username
             FROM egg_dispatch_routes r
             LEFT JOIN delivery_vehicles v ON r.vehicle_id = v.id
             LEFT JOIN users u ON r.driver_id = u.id
             WHERE r.id = ? AND r.company_id = ?`,
            [id, company_id]
        );

        if (routeRows.length === 0) {
            return res.status(404).json({ message: 'Ruta de despacho no encontrada.' });
        }

        const route = routeRows[0];

        // Obtener paradas con datos de pedido, cliente y sucursal
        const [stops] = await pool.query(
            `SELECT s.*,
                    o.order_number,
                    o.product_type,
                    o.presentation,
                    o.quantity_lbs,
                    o.price_per_lb,
                    o.notes AS order_notes,
                    ROUND(o.quantity_lbs / 30.0, 0) AS calculated_buckets,
                    c.nombre AS customer_name,
                    c.nombre_comercial AS customer_commercial_name,
                    c.nit AS customer_nit,
                    c.nrc AS customer_nrc,
                    c.telefono AS customer_phone,
                    cb.nombre AS branch_name,
                    cb.direccion AS branch_address,
                    cb.departamento AS branch_departamento,
                    cb.municipio AS branch_municipio,
                    cb.telefono AS branch_phone,
                    cb.contacto_nombre AS branch_contact_person,
                    cb.contacto_telefono AS branch_contact_phone,
                    cb.indicaciones_entrega AS branch_delivery_notes,
                    cb.latitude AS branch_latitude,
                    cb.longitude AS branch_longitude
             FROM egg_dispatch_stops s
             JOIN egg_customer_orders o ON s.order_id = o.id
             JOIN customers c ON s.customer_id = c.id
             LEFT JOIN customer_branches cb ON s.customer_branch_id = cb.id
             WHERE s.dispatch_route_id = ?
             ORDER BY s.orden_visita ASC, s.id ASC`,
            [id]
        );

        res.json({
            ...route,
            stops
        });
    } catch (error) {
        console.error('Error al obtener detalle de ruta:', error);
        res.status(500).json({ message: error.message });
    }
};

const saveDispatchRoute = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const company_id = req.company_id || req.user?.company_id;
        const { id } = req.params;
        const {
            codigo_ruta,
            fecha_despacho,
            vehicle_id,
            driver_id,
            driver_name,
            driver_phone,
            estado,
            hora_salida_estimada,
            odometro_inicial,
            odometro_final,
            distancia_km_estimada,
            notas_ruta,
            stops // Array de { order_id, customer_id, customer_branch_id, prioridad, orden_visita }
        } = req.body;

        if (!fecha_despacho) {
            await connection.rollback();
            return res.status(400).json({ message: 'La fecha de despacho es obligatoria.' });
        }

        // 1. Validar estado del camión si fue asignado
        let vehicleRecord = null;
        if (vehicle_id) {
            const [vCheck] = await connection.query(
                'SELECT id, codigo, placa, estado, capacidad_peso_lbs, capacidad_cubetas FROM delivery_vehicles WHERE id = ? AND company_id = ?',
                [vehicle_id, company_id]
            );
            if (vCheck.length === 0) {
                await connection.rollback();
                return res.status(400).json({ message: 'El camión seleccionado no existe o no pertenece a la empresa.' });
            }
            vehicleRecord = vCheck[0];

            if (vehicleRecord.estado === 'en_mantenimiento') {
                await connection.rollback();
                return res.status(400).json({ 
                    message: `El camión ${vehicleRecord.codigo} (${vehicleRecord.placa}) se encuentra EN MANTENIMIENTO y no puede ser programado en rutas activas.` 
                });
            }
            if (vehicleRecord.estado === 'inactivo') {
                await connection.rollback();
                return res.status(400).json({ 
                    message: `El camión ${vehicleRecord.codigo} (${vehicleRecord.placa}) está INACTIVO.` 
                });
            }
        }

        // 2. Generar código de ruta si no viene
        let routeCode = (codigo_ruta || '').trim();
        if (!routeCode) {
            const cleanDate = fecha_despacho.replace(/-/g, '');
            const [countRows] = await connection.query(
                'SELECT COUNT(*) as cnt FROM egg_dispatch_routes WHERE company_id = ? AND fecha_despacho = ?',
                [company_id, fecha_despacho]
            );
            const nextNum = (countRows[0].cnt || 0) + 1;
            routeCode = `RUTA-${cleanDate}-${String(nextNum).padStart(2, '0')}`;
        }

        // 3. Resolver nombre y teléfono del motorista si se seleccionó un usuario registrado
        let resolvedDriverName = driver_name || null;
        let resolvedDriverPhone = driver_phone || null;
        if (driver_id) {
            const [uRows] = await connection.query(
                'SELECT id, nombre, telefono FROM users WHERE id = ? AND company_id = ?',
                [driver_id, company_id]
            );
            if (uRows.length > 0) {
                resolvedDriverName = uRows[0].nombre;
                if (!resolvedDriverPhone && uRows[0].telefono) {
                    resolvedDriverPhone = uRows[0].telefono;
                }
            }
        }

        // 4. Calcular totales de carga de las paradas
        let totalPedidos = 0;
        let totalPesoLbs = 0;
        let totalCubetas = 0;

        const stopList = Array.isArray(stops) ? stops : [];
        if (stopList.length > 0) {
            const orderIds = stopList.map(s => s.order_id).filter(Boolean);
            if (orderIds.length > 0) {
                const [ordersData] = await connection.query(
                    `SELECT id, quantity_lbs FROM egg_customer_orders WHERE id IN (?) AND company_id = ?`,
                    [orderIds, company_id]
                );
                totalPedidos = ordersData.length;
                ordersData.forEach(o => {
                    const lbs = parseFloat(o.quantity_lbs) || 0;
                    totalPesoLbs += lbs;
                    totalCubetas += Math.ceil(lbs / 30.0);
                });
            }
        }

        let routeId = id;

        if (id) {
            await connection.query(
                `UPDATE egg_dispatch_routes SET
                    codigo_ruta = ?, fecha_despacho = ?, vehicle_id = ?,
                    driver_id = ?, driver_name = ?, driver_phone = ?,
                    estado = ?, hora_salida_estimada = ?, total_pedidos = ?,
                    total_peso_lbs = ?, total_cubetas = ?, odometro_inicial = ?,
                    odometro_final = ?, distancia_km_estimada = ?, notas_ruta = ?
                 WHERE id = ? AND company_id = ?`,
                [
                    routeCode,
                    fecha_despacho,
                    vehicle_id || null,
                    driver_id || null,
                    resolvedDriverName,
                    resolvedDriverPhone,
                    estado || 'planificada',
                    hora_salida_estimada || '07:00:00',
                    totalPedidos,
                    totalPesoLbs,
                    totalCubetas,
                    odometro_inicial ? parseFloat(odometro_inicial) : null,
                    odometro_final ? parseFloat(odometro_final) : null,
                    distancia_km_estimada ? parseFloat(distancia_km_estimada) : null,
                    notas_ruta || null,
                    id,
                    company_id
                ]
            );

            // Liberar pedidos anteriores que ya no estén en la ruta
            await connection.query(
                `UPDATE egg_customer_orders SET dispatch_route_id = NULL, delivery_status = 'pendiente'
                 WHERE dispatch_route_id = ? AND company_id = ?`,
                [id, company_id]
            );

            // Eliminar paradas previas para reconstruir la secuencia limpia
            await connection.query('DELETE FROM egg_dispatch_stops WHERE dispatch_route_id = ?', [id]);
        } else {
            const [insRes] = await connection.query(
                `INSERT INTO egg_dispatch_routes (
                    company_id, codigo_ruta, fecha_despacho, vehicle_id, driver_id,
                    driver_name, driver_phone, estado, hora_salida_estimada, total_pedidos,
                    total_peso_lbs, total_cubetas, odometro_inicial, odometro_final,
                    distancia_km_estimada, notas_ruta
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    company_id,
                    routeCode,
                    fecha_despacho,
                    vehicle_id || null,
                    driver_id || null,
                    resolvedDriverName,
                    resolvedDriverPhone,
                    estado || 'planificada',
                    hora_salida_estimada || '07:00:00',
                    totalPedidos,
                    totalPesoLbs,
                    totalCubetas,
                    odometro_inicial ? parseFloat(odometro_inicial) : null,
                    odometro_final ? parseFloat(odometro_final) : null,
                    distancia_km_estimada ? parseFloat(distancia_km_estimada) : null,
                    notas_ruta || null
                ]
            );
            routeId = insRes.insertId;
        }

        // 5. Insertar paradas y asociar pedidos
        for (let idx = 0; idx < stopList.length; idx++) {
            const stop = stopList[idx];
            const ordenVisita = stop.orden_visita !== undefined ? parseInt(stop.orden_visita) : (idx + 1);

            await connection.query(
                `INSERT INTO egg_dispatch_stops (
                    dispatch_route_id, order_id, customer_id, customer_branch_id,
                    orden_visita, prioridad, estado_entrega
                ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    routeId,
                    stop.order_id,
                    stop.customer_id,
                    stop.customer_branch_id || null,
                    ordenVisita,
                    stop.prioridad || 'normal',
                    'pendiente'
                ]
            );

            // Actualizar pedido a 'en_ruta' o 'programado'
            await connection.query(
                `UPDATE egg_customer_orders SET
                    dispatch_route_id = ?,
                    customer_branch_id = COALESCE(?, customer_branch_id),
                    delivery_status = 'en_ruta',
                    status = 'en_proceso',
                    priority = ?
                 WHERE id = ? AND company_id = ?`,
                [routeId, stop.customer_branch_id || null, stop.prioridad || 'normal', stop.order_id, company_id]
            );
        }

        // 6. Actualizar estado del camión a 'en_ruta' si la ruta pasa a en_curso
        if (vehicle_id && estado === 'en_curso') {
            await connection.query(
                'UPDATE delivery_vehicles SET estado = "en_ruta" WHERE id = ? AND company_id = ?',
                [vehicle_id, company_id]
            );
        }

        await connection.commit();

        res.json({
            id: routeId,
            codigo_ruta: routeCode,
            total_peso_lbs: totalPesoLbs,
            total_cubetas: totalCubetas,
            message: 'Ruta de despacho guardada exitosamente.'
        });
    } catch (error) {
        await connection.rollback();
        console.error('Error al guardar ruta de despacho:', error);
        res.status(500).json({ message: error.message });
    } finally {
        connection.release();
    }
};

const deleteDispatchRoute = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const { id } = req.params;
        const company_id = req.company_id || req.user?.company_id;

        // Liberar pedidos
        await connection.query(
            `UPDATE egg_customer_orders SET dispatch_route_id = NULL, delivery_status = 'pendiente'
             WHERE dispatch_route_id = ? AND company_id = ?`,
            [id, company_id]
        );

        // Liberar camión si estaba en ruta
        const [rRows] = await connection.query(
            'SELECT vehicle_id FROM egg_dispatch_routes WHERE id = ? AND company_id = ?',
            [id, company_id]
        );
        if (rRows.length > 0 && rRows[0].vehicle_id) {
            await connection.query(
                'UPDATE delivery_vehicles SET estado = "disponible" WHERE id = ? AND estado = "en_ruta"',
                [rRows[0].vehicle_id]
            );
        }

        await connection.query('DELETE FROM egg_dispatch_routes WHERE id = ? AND company_id = ?', [id, company_id]);

        await connection.commit();
        res.json({ message: 'Ruta de despacho eliminada y pedidos liberados.' });
    } catch (error) {
        await connection.rollback();
        console.error('Error al eliminar ruta de despacho:', error);
        res.status(500).json({ message: error.message });
    } finally {
        connection.release();
    }
};

const reorderRouteStops = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const { id } = req.params;
        const { stops } = req.body; // Array de { id: stop_id, orden_visita: N }

        if (!Array.isArray(stops)) {
            await connection.rollback();
            return res.status(400).json({ message: 'La lista de paradas a reordenar es inválida.' });
        }

        for (const s of stops) {
            await connection.query(
                'UPDATE egg_dispatch_stops SET orden_visita = ? WHERE id = ? AND dispatch_route_id = ?',
                [s.orden_visita, s.id, id]
            );
        }

        await connection.commit();
        res.json({ message: 'Secuencia de paradas actualizada exitosamente.' });
    } catch (error) {
        await connection.rollback();
        console.error('Error al reordenar paradas:', error);
        res.status(500).json({ message: error.message });
    } finally {
        connection.release();
    }
};

/**
 * Optimiza la secuencia de visitas:
 * 1. Prioridad: 'urgente' primero (peso 3), luego 'alta' (peso 2), luego 'normal' (peso 1).
 * 2. Proximidad geográfica: heurística de Nearest Neighbor o cercanía de departamento/municipio.
 */
const optimizeRouteStops = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const { id } = req.params;
        const company_id = req.company_id || req.user?.company_id;

        const [stops] = await connection.query(
            `SELECT s.id, s.prioridad, cb.latitude, cb.longitude, cb.departamento, cb.municipio
             FROM egg_dispatch_stops s
             JOIN egg_dispatch_routes r ON s.dispatch_route_id = r.id
             LEFT JOIN customer_branches cb ON s.customer_branch_id = cb.id
             WHERE s.dispatch_route_id = ? AND r.company_id = ?
             ORDER BY s.id ASC`,
            [id, company_id]
        );

        if (stops.length <= 1) {
            await connection.rollback();
            return res.json({ message: 'No hay suficientes paradas para optimizar.' });
        }

        // Ordenamiento por prioridad primero, luego cercanía geográfica
        const priorityWeight = { urgente: 1, alta: 2, normal: 3 };

        // Coordenadas base de planta (ej. San Salvador centro aprox 13.6929, -89.2182 si no hay)
        let currentLat = 13.6929;
        let currentLng = -89.2182;

        const unvisited = [...stops];
        const sorted = [];

        // Función de distancia simple (Haversine o euclidiana)
        const calcDist = (lat1, lon1, lat2, lon2) => {
            if (!lat1 || !lon1 || !lat2 || !lon2) return 9999;
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLon = (lon2 - lon1) * Math.PI / 180;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                      Math.sin(dLon / 2) * Math.sin(dLon / 2);
            return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        };

        // Agrupar por prioridad
        ['urgente', 'alta', 'normal'].forEach(prio => {
            const group = unvisited.filter(s => (s.prioridad || 'normal') === prio);
            // Ordenar el grupo por el vecino más cercano
            while (group.length > 0) {
                let bestIdx = 0;
                let minDist = Infinity;
                for (let i = 0; i < group.length; i++) {
                    const d = calcDist(currentLat, currentLng, group[i].latitude, group[i].longitude);
                    if (d < minDist) {
                        minDist = d;
                        bestIdx = i;
                    }
                }
                const chosen = group.splice(bestIdx, 1)[0];
                sorted.push(chosen);
                if (chosen.latitude && chosen.longitude) {
                    currentLat = parseFloat(chosen.latitude);
                    currentLng = parseFloat(chosen.longitude);
                }
            }
        });

        // Aplicar nuevo orden_visita en BD
        for (let i = 0; i < sorted.length; i++) {
            await connection.query(
                'UPDATE egg_dispatch_stops SET orden_visita = ? WHERE id = ?',
                [i + 1, sorted[i].id]
            );
        }

        await connection.commit();
        res.json({ message: 'Ruta optimizada con éxito según prioridad y cercanía geográfica.' });
    } catch (error) {
        await connection.rollback();
        console.error('Error al optimizar paradas:', error);
        res.status(500).json({ message: error.message });
    } finally {
        connection.release();
    }
};

// ==========================================
// 4. MODO MOTORISTA, QR DTE & CONFIRMACIÓN
// ==========================================

const getMyDriverRoutes = async (req, res) => {
    try {
        const company_id = req.company_id || req.user?.company_id;
        const userId = req.user?.id;
        const { fecha } = req.query;
        const targetDate = fecha || new Date().toISOString().split('T')[0];

        // Obtener rutas donde el usuario es el driver_id asignado, o todas las rutas de la fecha si tiene rol supervisor/admin
        let sql = `
            SELECT r.*,
                   v.codigo AS vehicle_codigo,
                   v.placa AS vehicle_placa,
                   v.tiene_termo_king,
                   (SELECT COUNT(*) FROM egg_dispatch_stops s WHERE s.dispatch_route_id = r.id) AS total_stops,
                   (SELECT COUNT(*) FROM egg_dispatch_stops s WHERE s.dispatch_route_id = r.id AND s.estado_entrega = 'entregado') AS completed_stops
            FROM egg_dispatch_routes r
            LEFT JOIN delivery_vehicles v ON r.vehicle_id = v.id
            WHERE r.company_id = ? AND r.fecha_despacho = ?
        `;
        const params = [company_id, targetDate];

        // Si no es rol admin/supervisor, filtrar solo sus rutas asignadas
        const isSupervisor = ['Admin', 'SuperAdmin', 'Gerencia', 'Operaciones'].includes(req.user?.role_name);
        if (!isSupervisor && userId) {
            sql += ' AND (r.driver_id = ? OR r.driver_name LIKE ?)';
            params.push(userId, `%${req.user?.nombre || ''}%`);
        }

        sql += ' ORDER BY r.hora_salida_estimada ASC, r.id DESC';

        const [routes] = await pool.query(sql, params);
        res.json(routes);
    } catch (error) {
        console.error('Error al obtener rutas del motorista:', error);
        res.status(500).json({ message: error.message });
    }
};

const searchDteOrActiveOrders = async (req, res) => {
    try {
        const company_id = req.company_id || req.user?.company_id;
        const { query } = req.query;

        if (!query || query.trim().length < 2) {
            return res.json({ dtes: [], orders: [] });
        }

        const cleanQuery = query.trim();

        // 1. Buscar en DTEs (código de generación, número de control o sello)
        const [dtes] = await pool.query(
            `SELECT d.id, d.codigo_generacion, d.numero_control, d.tipo_dte, d.status,
                    d.sello_recepcion, d.fh_procesamiento,
                    s.cliente_id, s.total, s.created_at
             FROM dtes d
             LEFT JOIN sales_headers s ON d.venta_id = s.id
             WHERE d.company_id = ? 
               AND (d.codigo_generacion LIKE ? OR d.numero_control LIKE ? OR d.sello_recepcion LIKE ?)
             LIMIT 10`,
            [company_id, `%${cleanQuery}%`, `%${cleanQuery}%`, `%${cleanQuery}%`]
        );

        // 2. Buscar en pedidos de clientes activos
        const [orders] = await pool.query(
            `SELECT o.id, o.order_number, o.customer_name, o.product_type, o.quantity_lbs,
                    o.delivery_status, o.required_delivery_date, o.customer_id, o.customer_branch_id
             FROM egg_customer_orders o
             WHERE o.company_id = ?
               AND o.delivery_status != 'entregado'
               AND (o.order_number LIKE ? OR o.customer_name LIKE ? OR o.product_type LIKE ?)
             LIMIT 10`,
            [company_id, `%${cleanQuery}%`, `%${cleanQuery}%`, `%${cleanQuery}%`]
        );

        res.json({ dtes, orders });
    } catch (error) {
        console.error('Error al buscar DTE u órdenes activas:', error);
        res.status(500).json({ message: error.message });
    }
};

/**
 * Confirmación de entrega en la parada:
 * - Registra la entrega con DTE escaneado, receptor, teléfono receptor y observaciones.
 * - Captura y guarda coordenadas GPS exactas (lat, lng).
 * - ACTUALIZA PERMANENTEMENTE la sucursal del cliente (`customer_branches`) con:
 *   * latitude, longitude
 *   * contacto_nombre ("por quién preguntar")
 *   * contacto_telefono ("número del receptor")
 *   * indicaciones_entrega
 */
const confirmStopDelivery = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const company_id = req.company_id || req.user?.company_id;
        const { stop_id } = req.params;
        const {
            dte_codigo_generacion,
            recibido_por,
            telefono_receptor,
            observaciones_entrega,
            latitude,
            longitude,
            update_branch_data // Boolean para actualizar o crear la sucursal
        } = req.body;

        const [stopRows] = await connection.query(
            `SELECT s.*, o.customer_id, o.customer_name, o.customer_branch_id AS order_branch_id,
                    r.id AS route_id, r.company_id AS route_company_id
             FROM egg_dispatch_stops s
             JOIN egg_customer_orders o ON s.order_id = o.id
             JOIN egg_dispatch_routes r ON s.dispatch_route_id = r.id
             WHERE s.id = ? AND r.company_id = ?`,
            [stop_id, company_id]
        );

        if (stopRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Parada de entrega no encontrada.' });
        }

        const stop = stopRows[0];
        const parsedLat = latitude !== undefined && latitude !== null && latitude !== '' ? parseFloat(latitude) : null;
        const parsedLng = longitude !== undefined && longitude !== null && longitude !== '' ? parseFloat(longitude) : null;
        const cleanRecibidoPor = (recibido_por || '').trim();
        const cleanTelefono = (telefono_receptor || '').trim();
        const cleanDte = (dte_codigo_generacion || '').trim().toUpperCase();

        // 1. Actualizar egg_dispatch_stops
        await connection.query(
            `UPDATE egg_dispatch_stops SET
                estado_entrega = 'entregado',
                hora_real_llegada = NOW(),
                dte_codigo_generacion = COALESCE(?, dte_codigo_generacion),
                recibido_por = ?,
                telefono_receptor = ?,
                observaciones_entrega = ?,
                lat_entrega = ?,
                lng_entrega = ?
             WHERE id = ?`,
            [
                cleanDte || null,
                cleanRecibidoPor || null,
                cleanTelefono || null,
                observaciones_entrega || null,
                parsedLat,
                parsedLng,
                stop_id
            ]
        );

        // 2. Actualizar egg_customer_orders
        await connection.query(
            `UPDATE egg_customer_orders SET
                delivery_status = 'entregado',
                status = 'entregado',
                delivered_at = NOW(),
                delivered_by_user_id = ?,
                dte_codigo_generacion = COALESCE(?, dte_codigo_generacion),
                recipient_name = ?,
                recipient_phone = ?,
                delivery_notes = ?
             WHERE id = ? AND company_id = ?`,
            [
                req.user?.id || null,
                cleanDte || null,
                cleanRecibidoPor || null,
                cleanTelefono || null,
                observaciones_entrega || null,
                stop.order_id,
                company_id
            ]
        );

        // 3. ACTUALIZAR O VINCULAR LA SUCURSAL DEL CLIENTE PARA FUTURAS ENTREGAS
        let branchId = stop.customer_branch_id || stop.order_branch_id;

        if (branchId) {
            // Actualizar sucursal existente
            const branchUpdates = [];
            const bParams = [];

            if (parsedLat !== null && parsedLng !== null) {
                branchUpdates.push('latitude = ?', 'longitude = ?');
                bParams.push(parsedLat, parsedLng);
            }
            if (cleanRecibidoPor) {
                branchUpdates.push('contacto_nombre = ?');
                bParams.push(cleanRecibidoPor);
            }
            if (cleanTelefono) {
                branchUpdates.push('contacto_telefono = ?', 'telefono = COALESCE(telefono, ?)');
                bParams.push(cleanTelefono, cleanTelefono);
            }
            if (observaciones_entrega) {
                branchUpdates.push('indicaciones_entrega = ?');
                bParams.push(observaciones_entrega);
            }

            if (branchUpdates.length > 0) {
                bParams.push(branchId, company_id);
                await connection.query(
                    `UPDATE customer_branches SET ${branchUpdates.join(', ')} WHERE id = ? AND company_id = ?`,
                    bParams
                );
            }
        } else if (stop.customer_id) {
            // Si el cliente aún no tenía sucursal creada, crear "Sucursal Principal / Entrega" con las coordenadas y contacto capturados
            const [custData] = await connection.query(
                'SELECT nombre, direccion, departamento, municipio, telefono FROM customers WHERE id = ? AND company_id = ?',
                [stop.customer_id, company_id]
            );
            if (custData.length > 0) {
                const c = custData[0];
                const [newBranch] = await connection.query(
                    `INSERT INTO customer_branches (
                        customer_id, company_id, nombre, departamento, municipio,
                        direccion, telefono, contacto_nombre, contacto_telefono,
                        latitude, longitude, indicaciones_entrega
                    ) VALUES (?, ?, 'Sucursal Principal', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        stop.customer_id,
                        company_id,
                        c.departamento || '06',
                        c.municipio || '14',
                        c.direccion || 'Dirección de Entrega',
                        cleanTelefono || c.telefono || null,
                        cleanRecibidoPor || null,
                        cleanTelefono || null,
                        parsedLat,
                        parsedLng,
                        observaciones_entrega || null
                    ]
                );
                branchId = newBranch.insertId;

                // Vincular la nueva sucursal a la parada y al pedido
                await connection.query('UPDATE egg_dispatch_stops SET customer_branch_id = ? WHERE id = ?', [branchId, stop_id]);
                await connection.query('UPDATE egg_customer_orders SET customer_branch_id = ? WHERE id = ?', [branchId, stop.order_id]);
            }
        }

        // 4. Verificar si todas las paradas de la ruta fueron completadas
        const [pendingStops] = await connection.query(
            `SELECT COUNT(*) as pending_count 
             FROM egg_dispatch_stops 
             WHERE dispatch_route_id = ? AND estado_entrega != 'entregado'`,
            [stop.route_id]
        );

        if (pendingStops[0].pending_count === 0) {
            await connection.query(
                `UPDATE egg_dispatch_routes SET estado = 'completada', hora_llegada_real = NOW()
                 WHERE id = ? AND company_id = ?`,
                [stop.route_id, company_id]
            );

            // Liberar camión si estaba en ruta
            const [rCheck] = await connection.query('SELECT vehicle_id FROM egg_dispatch_routes WHERE id = ?', [stop.route_id]);
            if (rCheck.length > 0 && rCheck[0].vehicle_id) {
                await connection.query('UPDATE delivery_vehicles SET estado = "disponible" WHERE id = ?', [rCheck[0].vehicle_id]);
            }
        }

        await connection.commit();

        res.json({
            message: 'Entrega confirmada y datos de sucursal actualizados para futuras visitas.',
            branch_id: branchId,
            route_completed: pendingStops[0].pending_count === 0
        });
    } catch (error) {
        await connection.rollback();
        console.error('Error al confirmar entrega:', error);
        res.status(500).json({ message: error.message });
    } finally {
        connection.release();
    }
};

const updateCustomerBranchLocation = async (req, res) => {
    try {
        const company_id = req.company_id || req.user?.company_id;
        const { branch_id } = req.params;
        const { latitude, longitude, contacto_nombre, contacto_telefono, indicaciones_entrega, direccion } = req.body;

        if (!branch_id) {
            return res.status(400).json({ message: 'El ID de la sucursal es obligatorio.' });
        }

        await pool.query(
            `UPDATE customer_branches SET
                latitude = COALESCE(?, latitude),
                longitude = COALESCE(?, longitude),
                contacto_nombre = COALESCE(?, contacto_nombre),
                contacto_telefono = COALESCE(?, contacto_telefono),
                indicaciones_entrega = COALESCE(?, indicaciones_entrega),
                direccion = COALESCE(?, direccion)
             WHERE id = ? AND company_id = ?`,
            [
                latitude ? parseFloat(latitude) : null,
                longitude ? parseFloat(longitude) : null,
                contacto_nombre ? contacto_nombre.trim() : null,
                contacto_telefono ? contacto_telefono.trim() : null,
                indicaciones_entrega ? indicaciones_entrega.trim() : null,
                direccion ? direccion.trim() : null,
                branch_id,
                company_id
            ]
        );

        res.json({ message: 'Ubicación y contacto de la sucursal actualizados exitosamente.' });
    } catch (error) {
        console.error('Error al actualizar ubicación de sucursal:', error);
        res.status(500).json({ message: error.message });
    }
};

const getCustomerBranches = async (req, res) => {
    try {
        const company_id = req.company_id || req.user?.company_id;
        const { customer_id } = req.query;

        let sql = `
            SELECT cb.*, c.nombre AS customer_name
            FROM customer_branches cb
            JOIN customers c ON cb.customer_id = c.id
            WHERE cb.company_id = ?
        `;
        const params = [company_id];

        if (customer_id) {
            sql += ' AND cb.customer_id = ?';
            params.push(customer_id);
        }

        sql += ' ORDER BY c.nombre ASC, cb.nombre ASC';

        const [branches] = await pool.query(sql, params);
        res.json(branches);
    } catch (error) {
        console.error('Error al listar sucursales:', error);
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    // Vehículos
    getVehicles,
    saveVehicle,
    deleteVehicle,

    // Mantenimientos
    getMaintenanceLogs,
    saveMaintenanceLog,
    deleteMaintenanceLog,

    // Rutas
    getDispatchRoutes,
    getDispatchRouteDetail,
    saveDispatchRoute,
    deleteDispatchRoute,
    reorderRouteStops,
    optimizeRouteStops,

    // Motorista & Entregas
    getMyDriverRoutes,
    searchDteOrActiveOrders,
    confirmStopDelivery,
    updateCustomerBranchLocation,
    getCustomerBranches
};
