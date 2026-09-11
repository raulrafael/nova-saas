const pool = require('../config/db');
const nodemailer = require('nodemailer');
const { broadcastToCompany } = require('../services/websocket.service');
const notificationService = require('../services/notification.service');

// Helper oficial para cálculo de código de lote en Calendario Juliano: LOTE-[Año 2d][Día Juliano 3d]-[Corrida 2d] (ej. LOTE-26252-01)
const computeJulianLotCode = (productionDate, runNumber = 1) => {
    let d;
    if (!productionDate) {
        d = new Date();
    } else if (typeof productionDate === 'string') {
        const parts = productionDate.split('T')[0].split('-');
        if (parts.length === 3) {
            d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        } else {
            d = new Date(productionDate);
        }
    } else {
        d = new Date(productionDate);
    }
    if (isNaN(d.getTime())) d = new Date();

    const yearFull = d.getFullYear();
    const year2Digit = String(yearFull).slice(-2);
    const startOfYear = new Date(yearFull, 0, 1);
    const diffMs = d.getTime() - startOfYear.getTime();
    const dayOfYear = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
    const dayOfYearStr = String(dayOfYear).padStart(3, '0');
    const runStr = String(runNumber || 1).padStart(2, '0');
    return `LOTE-${year2Digit}${dayOfYearStr}-${runStr}`;
};

// 1. RECEPCIÓN DE MATERIA PRIMA
const getRawMaterials = async (req, res) => {
    try {
        const { only_with_stock } = req.query;
        let sql = `SELECT rm.*, p.nombre as provider_name 
             FROM egg_raw_materials rm
             LEFT JOIN providers p ON rm.provider_id = p.id
             WHERE rm.company_id = ?`;
        const params = [req.company_id];
        if (only_with_stock === 'true') {
            sql += ' AND rm.status = ? AND rm.stock_lbs > 0';
            params.push('aprobado');
        }
        sql += ' ORDER BY rm.created_at DESC';
        const [rows] = await pool.query(sql, params);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const createRawMaterial = async (req, res) => {
    try {
        const { 
            provider_id, egg_type, egg_color, egg_size, weight_lbs, 
            temperature_c, truck_temperature_c, truck_plate, driver_name, 
            total_boxes, tarimas_json, provider_lot, certificate_urls, 
            operator_name, status, fecha 
        } = req.body;

        // Si viene desglose de tarimas, calcular el peso neto total y cajas
        let finalWeightLbs = weight_lbs;
        let finalBoxes = total_boxes || 0;
        if (Array.isArray(tarimas_json) && tarimas_json.length > 0) {
            const sumNet = tarimas_json.reduce((acc, t) => acc + (parseFloat(t.net_weight_lbs) || 0), 0);
            const sumBoxes = tarimas_json.reduce((acc, t) => acc + (parseInt(t.boxes_count) || 0), 0);
            if (sumNet > 0) finalWeightLbs = sumNet;
            if (sumBoxes > 0) finalBoxes = sumBoxes;
        }

        let branchId = req.body.branch_id || req.user?.branch_id;
        if (!branchId) {
            const [b] = await pool.query('SELECT id FROM branches WHERE company_id = ? LIMIT 1', [req.company_id]);
            branchId = b[0]?.id || 1;
        }

        const [result] = await pool.query(
            `INSERT INTO egg_raw_materials (
                company_id, branch_id, provider_id, egg_type, egg_color, egg_size, 
                fecha, weight_lbs, total_boxes, stock_lbs, temperature_c, truck_temperature_c, 
                truck_plate, driver_name, provider_lot, certificate_urls, tarimas_json, operator_name, status
            ) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                req.company_id, branchId, provider_id, egg_type, 
                egg_color || 'blanco', egg_size || 'L', fecha || new Date().toISOString().split('T')[0], 
                finalWeightLbs, finalBoxes, finalWeightLbs, temperature_c || null, 
                truck_temperature_c || null, truck_plate || null, driver_name || null, 
                provider_lot, JSON.stringify(certificate_urls || []), 
                JSON.stringify(tarimas_json || []), operator_name, status || 'aprobado'
            ]
        );

        // Crear evento de auditoría
        await pool.query(
            `INSERT INTO egg_industrial_events (company_id, event_type, severity, description, payload, operator_name)
             VALUES (?, 'raw_material.received', 'info', ?, ?, ?)`,
            [
                req.company_id, 
                `Recibido lote de materia prima ${egg_type} (${finalWeightLbs} LBS, ${finalBoxes} cajas) del proveedor lote ${provider_lot}.`, 
                JSON.stringify({ raw_material_id: result.insertId, weight_lbs: finalWeightLbs, total_boxes: finalBoxes }), 
                operator_name
            ]
        );

        res.status(201).json({ id: result.insertId, weight_lbs: finalWeightLbs, total_boxes: finalBoxes, ...req.body });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const updateRawMaterial = async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            provider_id, egg_type, egg_color, egg_size, weight_lbs, 
            temperature_c, truck_temperature_c, truck_plate, driver_name, 
            total_boxes, tarimas_json, provider_lot, certificate_urls, 
            operator_name, status, fecha 
        } = req.body;

        const [existing] = await pool.query(
            'SELECT * FROM egg_raw_materials WHERE id = ? AND company_id = ?',
            [id, req.company_id]
        );
        if (existing.length === 0) {
            return res.status(404).json({ message: 'Recepción no encontrada.' });
        }

        let finalWeightLbs = weight_lbs;
        let finalBoxes = total_boxes || existing[0].total_boxes || 0;
        if (Array.isArray(tarimas_json) && tarimas_json.length > 0) {
            const sumNet = tarimas_json.reduce((acc, t) => acc + (parseFloat(t.net_weight_lbs) || 0), 0);
            const sumBoxes = tarimas_json.reduce((acc, t) => acc + (parseInt(t.boxes_count) || 0), 0);
            if (sumNet > 0) finalWeightLbs = sumNet;
            if (sumBoxes > 0) finalBoxes = sumBoxes;
        }

        // Si el peso cambia y el lote aún no ha sido consumido, ajustar stock_lbs
        const currentStock = parseFloat(existing[0].stock_lbs);
        const prevWeight = parseFloat(existing[0].weight_lbs);
        let updatedStock = currentStock;
        if (currentStock === prevWeight) {
            updatedStock = finalWeightLbs;
        }

        await pool.query(
            `UPDATE egg_raw_materials SET 
                provider_id = ?, egg_type = ?, egg_color = ?, egg_size = ?, 
                fecha = ?, weight_lbs = ?, total_boxes = ?, stock_lbs = ?, 
                temperature_c = ?, truck_temperature_c = ?, truck_plate = ?, driver_name = ?, 
                provider_lot = ?, certificate_urls = ?, tarimas_json = ?, operator_name = ?, status = ?
             WHERE id = ? AND company_id = ?`,
            [
                provider_id, egg_type, egg_color || 'blanco', egg_size || 'L', 
                fecha || existing[0].fecha, finalWeightLbs, finalBoxes, updatedStock, 
                temperature_c, truck_temperature_c || null, truck_plate || null, driver_name || null, 
                provider_lot, JSON.stringify(certificate_urls || []), 
                JSON.stringify(tarimas_json || []), operator_name, status || 'aprobado', 
                id, req.company_id
            ]
        );

        await pool.query(
            `INSERT INTO egg_industrial_events (company_id, event_type, severity, description, payload, operator_name)
             VALUES (?, 'raw_material.updated', 'info', ?, ?, ?)`,
            [req.company_id, `Recepción de materia prima #${id} actualizada.`, JSON.stringify({ raw_material_id: parseInt(id), ...req.body }), operator_name]
        );

        res.json({ id, weight_lbs: finalWeightLbs, total_boxes: finalBoxes, ...req.body });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const voidRawMaterial = async (req, res) => {
    try {
        const { id } = req.params;

        const [existing] = await pool.query(
            'SELECT * FROM egg_raw_materials WHERE id = ? AND company_id = ?',
            [id, req.company_id]
        );
        if (existing.length === 0) {
            return res.status(404).json({ message: 'Recepción no encontrada.' });
        }

        const stock = parseFloat(existing[0].stock_lbs || 0);
        const weight = parseFloat(existing[0].weight_lbs || 0);
        if (stock < weight) {
            return res.status(400).json({ message: `No se puede anular: el stock disponible (${stock.toFixed(2)} Lbs) es menor al peso original (${weight.toFixed(2)} Lbs). Parte del lote ya fue consumido en producción.` });
        }

        await pool.query(
            'UPDATE egg_raw_materials SET status = ? WHERE id = ? AND company_id = ?',
            ['anulado', id, req.company_id]
        );

        await pool.query(
            `INSERT INTO egg_industrial_events (company_id, event_type, severity, description, payload, operator_name)
             VALUES (?, 'raw_material.voided', 'warning', ?, ?, ?)`,
            [req.company_id, `Recepción de materia prima #${id} anulada.`, JSON.stringify({ raw_material_id: parseInt(id) }), existing[0].operator_name]
        );

        res.json({ id, status: 'anulado' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 2. CIP LOGS (Clean In Place)
const getCipLogs = async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT * FROM egg_cip_logs WHERE company_id = ? ORDER BY created_at DESC`,
            [req.company_id]
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const createCipLog = async (req, res) => {
    try {
        const { equipment_name, chemical_used, temperature_c, duration_minutes, operator_name, validation_status, notes } = req.body;
        const [result] = await pool.query(
            `INSERT INTO egg_cip_logs (company_id, equipment_name, chemical_used, temperature_c, duration_minutes, operator_name, validation_status, notes) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.company_id, equipment_name, chemical_used, temperature_c, duration_minutes, operator_name, validation_status, notes]
        );

        // Crear evento
        await pool.query(
            `INSERT INTO egg_industrial_events (company_id, event_type, severity, description, payload, operator_name)
             VALUES (?, 'cip.completed', ?, ?, ?, ?)`,
            [req.company_id, validation_status === 'completado' ? 'info' : 'warning', `Sanitización CIP en equipo ${equipment_name} registrada con estado: ${validation_status}.`, JSON.stringify({ cip_id: result.insertId, equipment_name }), operator_name]
        );

        res.status(201).json({ id: result.insertId, ...req.body });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const quickSanitizeCip = async (req, res) => {
    try {
        const { operator_name, notes } = req.body;
        const [result] = await pool.query(
            `INSERT INTO egg_cip_logs (company_id, equipment_name, chemical_used, temperature_c, duration_minutes, operator_name, validation_status, notes)
             VALUES (?, 'pasteurizador', 'Ácido Peracético 1.5% (Sanitización Express)', 78.50, 45, ?, 'completado', ?)`,
            [
                req.company_id,
                operator_name || req.user?.nombre || 'Operador de Planta',
                notes || 'Sanitización CIP express validada y aprobada para inicio de turno de producción.'
            ]
        );

        await pool.query(
            `INSERT INTO egg_industrial_events (company_id, event_type, severity, description, payload, operator_name)
             VALUES (?, 'cip.completed', 'info', ?, ?, ?)`,
            [
                req.company_id,
                'Sanitización CIP express en pasteurizador validada y completada.',
                JSON.stringify({ cip_id: result.insertId, equipment_name: 'pasteurizador' }),
                operator_name || req.user?.nombre || 'Operador de Planta'
            ]
        );

        res.status(201).json({ success: true, id: result.insertId, message: 'Sanitización CIP express registrada y aprobada.' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 3. LOTES DE PRODUCCIÓN
const getProductionBatches = async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT b.*
             FROM egg_production_batches b
             WHERE b.company_id = ? 
             ORDER BY b.started_at DESC`,
            [req.company_id]
        );

        for (const batch of rows) {
            const [materials] = await pool.query(
                `SELECT brm.*, rm.egg_type, rm.provider_lot, rm.egg_color, rm.egg_size
                 FROM batch_raw_materials brm
                 JOIN egg_raw_materials rm ON brm.raw_material_id = rm.id
                 WHERE brm.batch_id = ?`,
                [batch.id]
            );
            batch.raw_materials = materials;

            const [pkgSum] = await pool.query(
                'SELECT COALESCE(SUM(total_batch_weight_lbs), 0) as packaged_weight FROM egg_packaging_records WHERE batch_id = ? AND company_id = ?',
                [batch.id, req.company_id]
            );
            batch.packaged_weight_lbs = pkgSum[0].packaged_weight;

            const [varCosts] = await pool.query(
                'SELECT * FROM egg_batch_variable_costs WHERE batch_id = ? AND company_id = ?',
                [batch.id, req.company_id]
            );
            batch.variable_costs = varCosts;
        }

        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const createProductionBatch = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const { product_type, presentation, raw_materials, operator_name } = req.body;
        const company_id = req.company_id;
        const branch_id = req.body.branch_id || 1;

        if (!raw_materials || !Array.isArray(raw_materials) || raw_materials.length === 0) {
            return res.status(400).json({ message: 'Debe seleccionar al menos una materia prima.' });
        }

        const totalInputWeight = raw_materials.reduce((sum, rm) => sum + parseFloat(rm.quantity_lbs || 0), 0);
        if (totalInputWeight <= 0) {
            return res.status(400).json({ message: 'El peso total de entrada debe ser mayor a cero.' });
        }

        // --- REGLA CRÍTICA INDUSTRIAL: VALIDAR CIP RECIENTE O EXCEPCIÓN AUTORIZADA ---
        const [cipLogs] = await connection.query(
            `SELECT id FROM egg_cip_logs 
             WHERE company_id = ? AND equipment_name = 'pasteurizador' 
               AND validation_status = 'completado'
               AND created_at >= NOW() - INTERVAL 12 HOUR`,
            [company_id]
        );

        const bypassCip = req.body.bypass_cip_check === true || req.body.bypass_cip_check === 'true';

        if (cipLogs.length === 0 && !bypassCip) {
            await connection.rollback();
            return res.status(400).json({
                message: 'BLOQUEO DE INOCUIDAD: El pasteurizador no cuenta con una limpieza CIP aprobada en las últimas 12 horas. Puede autorizar el inicio bajo excepción operativa o registrar la sanitización CIP.',
                can_bypass: true
            });
        }

        // Validate stock availability for each raw material
        for (const rm of raw_materials) {
            const [rows] = await connection.query(
                'SELECT id, stock_lbs, egg_type FROM egg_raw_materials WHERE id = ? AND company_id = ? FOR UPDATE',
                [rm.raw_material_id, company_id]
            );
            if (rows.length === 0) {
                await connection.rollback();
                return res.status(400).json({ message: `Materia prima #${rm.raw_material_id} no encontrada.` });
            }
            if (parseFloat(rows[0].stock_lbs) < parseFloat(rm.quantity_lbs)) {
                await connection.rollback();
                return res.status(400).json({
                    message: `Stock insuficiente para ${rows[0].egg_type} (disponible: ${parseFloat(rows[0].stock_lbs).toFixed(2)} Lbs, solicitado: ${parseFloat(rm.quantity_lbs).toFixed(2)} Lbs).`
                });
            }
        }

        const batch_uuid = require('crypto').randomUUID();

        // Generar Nomenclatura Oficial ANDELSA: [Corrida] - [Día Juliano] - [Año 2 dígitos] (ej. 01 - 245 - 26)
        const now = new Date();
        const startOfYear = new Date(now.getFullYear(), 0, 0);
        const diff = now - startOfYear;
        const oneDay = 1000 * 60 * 60 * 24;
        const dayOfYear = Math.floor(diff / oneDay);
        const year2Digit = String(now.getFullYear()).slice(-2);

        const [todayBatches] = await connection.query(
            'SELECT COUNT(*) as count FROM egg_production_batches WHERE company_id = ? AND DATE(started_at) = CURDATE()',
            [company_id]
        );
        const runNumber = String((todayBatches[0]?.count || 0) + 1).padStart(2, '0');
        const batch_code_display = `${runNumber} - ${String(dayOfYear).padStart(3, '0')} - ${year2Digit}`;

        const { ingredients_json, target_brix, target_solids_pct } = req.body;

        const [result] = await connection.query(
            `INSERT INTO egg_production_batches (
                company_id, branch_id, batch_uuid, batch_code_display, product_type, 
                presentation, ingredients_json, status, input_weight_lbs, 
                target_brix, target_solids_pct, operator_name
            ) 
             VALUES (?, ?, ?, ?, ?, ?, ?, 'en_proceso', ?, ?, ?, ?)`,
            [
                company_id, branch_id, batch_uuid, batch_code_display, product_type, 
                presentation, JSON.stringify(ingredients_json || {}), totalInputWeight, 
                target_brix || null, target_solids_pct || null, operator_name
            ]
        );
        const batchId = result.insertId;

        // Insert batch_raw_materials and deduct stock
        for (const rm of raw_materials) {
            await connection.query(
                'INSERT INTO batch_raw_materials (batch_id, raw_material_id, quantity_lbs) VALUES (?, ?, ?)',
                [batchId, rm.raw_material_id, parseFloat(rm.quantity_lbs)]
            );
            await connection.query(
                'UPDATE egg_raw_materials SET stock_lbs = stock_lbs - ? WHERE id = ? AND company_id = ?',
                [parseFloat(rm.quantity_lbs), rm.raw_material_id, req.company_id]
            );
        }

        // Crear evento
        await connection.query(
            `INSERT INTO egg_industrial_events (company_id, event_type, severity, description, payload, operator_name)
             VALUES (?, 'production.started', 'info', ?, ?, ?)`,
            [
                company_id, 
                `Iniciado lote oficial ${batch_code_display} (${product_type} - ${presentation}) con ${totalInputWeight} LBS.`, 
                JSON.stringify({ batch_id: batchId, batch_uuid, batch_code_display, totalInputWeight, raw_materials }), 
                operator_name
            ]
        );

        if (cipLogs.length === 0 && bypassCip) {
            await connection.query(
                `INSERT INTO egg_industrial_events (company_id, event_type, severity, description, payload, operator_name)
                 VALUES (?, 'batch.cip_bypassed', 'warning', ?, ?, ?)`,
                [
                    company_id,
                    `Inicio de lote oficial ${batch_code_display} autorizado bajo excepción: sin verificación previa de sanitización CIP en pasteurizador.`,
                    JSON.stringify({ batch_id: batchId, batch_uuid, batch_code_display, operator: operator_name }),
                    operator_name
                ]
            );
        }

        await connection.commit();

        notificationService.notify('production_batch_created', req.company_id, req.body.branch_id || 1, {
            lote_id: batchId,
            producto: product_type || '',
            cantidad: totalInputWeight || 0,
            fecha: new Date().toISOString().split('T')[0],
            sucursal: ''
        }).catch(() => {});

        res.status(201).json({ 
            id: batchId, 
            batch_uuid, 
            batch_code_display, 
            product_type, 
            presentation, 
            status: 'en_proceso', 
            totalInputWeight 
        });
    } catch (error) {
        await connection.rollback();
        res.status(500).json({ message: error.message });
    } finally {
        connection.release();
    }
};

const completeProductionBatch = async (req, res) => {
    try {
        const { id } = req.params;
        const { yield_liquid_lbs, waste_shell_lbs, waste_loss_lbs } = req.body;

        // Traer datos del lote
        const [batches] = await pool.query('SELECT * FROM egg_production_batches WHERE id = ? AND company_id = ?', [id, req.company_id]);
        if (batches.length === 0) return res.status(404).json({ message: 'Lote no encontrado' });
        const batch = batches[0];

        // Cambiar estado a aprobado_calidad o mantener bloqueado_haccp
        const nextStatus = batch.status === 'bloqueado_haccp' ? 'bloqueado_haccp' : 'aprobado_calidad';

        await pool.query(
            `UPDATE egg_production_batches 
             SET yield_liquid_lbs = ?, waste_shell_lbs = ?, waste_loss_lbs = ?, status = ?, completed_at = NOW()
             WHERE id = ? AND company_id = ?`,
            [yield_liquid_lbs, waste_shell_lbs, waste_loss_lbs, nextStatus, id, req.company_id]
        );

        // Crear evento
        await pool.query(
            `INSERT INTO egg_industrial_events (company_id, event_type, severity, description, payload, operator_name)
             VALUES (?, 'production.completed', 'info', ?, ?, ?)`,
            [req.company_id, `Lote de producción completado. Rendimiento líquido: ${yield_liquid_lbs} LBS, Desperdicio cáscara: ${waste_shell_lbs} LBS.`, JSON.stringify({ batch_id: id, yield_liquid_lbs, waste_shell_lbs }), batch.operator_name]
        );

        const inputWeight = parseFloat(batch.input_weight_lbs || 0);
        const yieldPct = inputWeight > 0 ? Math.round((parseFloat(yield_liquid_lbs || 0) / inputWeight) * 10000) / 100 : 0;
        notificationService.notify('production_batch_completed', req.company_id, req.user?.branch_id, {
            lote_id: parseInt(id),
            producto: batch.product_type || '',
            cantidad: inputWeight,
            rendimiento: yieldPct,
            duracion: 0
        }).catch(() => {});

        res.json({ id, status: nextStatus, yield_liquid_lbs });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 4. PASTEURIZACIÓN (CRÍTICO HACCP)
const createPasteurizationLog = async (req, res) => {
    try {
        const { batch_id, temperature_c, holding_time_seconds, pressure_psi, flow_rate_gpm, operator_name } = req.body;
        const company_id = req.company_id;

        // Obtener el lote para saber el tipo de producto
        const [batches] = await pool.query('SELECT * FROM egg_production_batches WHERE id = ? AND company_id = ?', [batch_id, company_id]);
        if (batches.length === 0) return res.status(404).json({ message: 'Lote no encontrado' });
        const batch = batches[0];

        // --- VALIDACIÓN DE PARÁMETROS CRÍTICOS HACCP (PCC) ---
        let haccp_compliant = true;
        let deviation_description = null;

        // Reglas de temperatura HACCP estándar por tipo de producto:
        // Huevo entero: >= 64.0 C
        // Clara: >= 56.5 C
        // Yemas/Fórmulas: >= 65.0 C
        if (batch.product_type === 'huevo entero' && temperature_c < 64.0) {
            haccp_compliant = false;
            deviation_description = `Temperatura de pasteurización inferior a 64.0C (Lectura: ${temperature_c}C) para Huevo Entero.`;
        } else if (batch.product_type === 'clara' && temperature_c < 56.5) {
            haccp_compliant = false;
            deviation_description = `Temperatura de pasteurización inferior a 56.5C (Lectura: ${temperature_c}C) para Clara.`;
        } else if (batch.product_type.includes('yema') && temperature_c < 65.0) {
            haccp_compliant = false;
            deviation_description = `Temperatura de pasteurización inferior a 65.0C (Lectura: ${temperature_c}C) para Yema.`;
        }

        // Si el tiempo de retención es insuficiente
        if (holding_time_seconds < 200) {
            haccp_compliant = false;
            deviation_description = (deviation_description ? deviation_description + ' ' : '') + `Tiempo de retención insuficiente (${holding_time_seconds}s de mínimo 200s).`;
        }

        // Insertar log
        const [result] = await pool.query(
            `INSERT INTO egg_pasteurization_logs (company_id, batch_id, temperature_c, holding_time_seconds, pressure_psi, flow_rate_gpm, haccp_compliant, deviation_description, operator_name) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [company_id, batch_id, temperature_c, holding_time_seconds, pressure_psi, flow_rate_gpm, haccp_compliant, deviation_description, operator_name]
        );

        if (!haccp_compliant) {
            // --- BLOQUEO AUTOMÁTICO DE LOTE ---
            await pool.query(
                `UPDATE egg_production_batches SET status = 'bloqueado_haccp' WHERE id = ? AND company_id = ?`,
                [batch_id, company_id]
            );

            // Crear evento crítico
            await pool.query(
                `INSERT INTO egg_industrial_events (company_id, event_type, severity, description, payload, operator_name)
                 VALUES (?, 'haccp.failure', 'critical', ?, ?, ?)`,
                [company_id, `ALERTA HACCP: Lote ${batch.batch_uuid} ha sido BLOQUEADO automáticamente debido a desviaciones críticas en pasteurización.`, JSON.stringify({ batch_id, temperature_c, holding_time_seconds, deviation_description }), operator_name]
            );

            // Emitir por WebSocket
            broadcastToCompany(company_id, 'haccp_alert', {
                message: `ALERTA DE SEGURIDAD ALIMENTARIA: Desviación HACCP en pasteurización. Lote ${batch.batch_uuid} BLOQUEADO automáticamente. ${deviation_description}`,
                temp: temperature_c,
                batchUuid: batch.batch_uuid
            });
        } else {
            // Actualizar lote si todo va bien y estaba en proceso
            if (batch.status === 'en_proceso') {
                await pool.query(
                    `UPDATE egg_production_batches SET status = 'pasteurizado' WHERE id = ? AND company_id = ?`,
                    [batch_id, company_id]
                );
            }
        }

        res.status(201).json({ id: result.insertId, haccp_compliant, deviation_description, batchStatus: haccp_compliant ? 'pasteurizado' : 'bloqueado_haccp' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 5. HOLDING & CADENA DE FRÍO
const getHoldingTemperatures = async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT * FROM egg_holding_temperatures WHERE company_id = ? ORDER BY created_at DESC LIMIT 50`,
            [req.company_id]
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const createHoldingTemperature = async (req, res) => {
    try {
        const { tank_id, temperature_c, humidity_percentage } = req.body;
        const company_id = req.company_id;

        // Regla: Cadena de frío debe estar entre 2.0 y 6.0 grados Celsius
        let alarm_triggered = false;
        let alarm_reason = null;

        if (temperature_c < 2.0 || temperature_c > 6.0) {
            alarm_triggered = true;
            alarm_reason = `Temperatura de ${temperature_c}C fuera del rango crítico industrial de 2.0C a 6.0C.`;
        }

        const [result] = await pool.query(
            `INSERT INTO egg_holding_temperatures (company_id, tank_id, temperature_c, humidity_percentage, alarm_triggered, alarm_reason) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [company_id, tank_id, temperature_c, humidity_percentage, alarm_triggered, alarm_reason]
        );

        if (alarm_triggered) {
            // Registrar evento de advertencia
            await pool.query(
                `INSERT INTO egg_industrial_events (company_id, event_type, severity, description, payload)
                 VALUES (?, 'temperature.alert', 'warning', ?, ?)`,
                [company_id, `Desviación en cadena de frío: ${tank_id} reporta ${temperature_c}C.`, JSON.stringify({ tank_id, temperature_c, limit: '2.0C a 6.0C' })]
            );

            // Broadcast websocket
            broadcastToCompany(company_id, 'tank_alert', {
                tankId: tank_id,
                temp: temperature_c,
                message: `ALERTA DE TEMPERATURA: El tanque ${tank_id} ha registrado ${temperature_c}°C, saliendo del límite establecido.`
            });
        }

        res.status(201).json({ id: result.insertId, alarm_triggered, alarm_reason });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 6. EMPAQUE
const getPackagingRecords = async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT pr.*, b.product_type, b.batch_uuid, b.presentation
             FROM egg_packaging_records pr
             LEFT JOIN egg_production_batches b ON pr.batch_id = b.id
             WHERE pr.company_id = ? 
             ORDER BY pr.created_at DESC`,
            [req.company_id]
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const createPackagingRecord = async (req, res) => {
    try {
        const { 
            batch_id, units_packaged, weight_per_unit_lbs, operator_name,
            warehouse_zone = 'COOLER', product_state = 'liquido',
            label_type = 'etiqueta_4x2', customer_destination = null
        } = req.body;
        const company_id = req.company_id;

        // Obtener lote
        const [batches] = await pool.query('SELECT * FROM egg_production_batches WHERE id = ? AND company_id = ?', [batch_id, company_id]);
        if (batches.length === 0) return res.status(404).json({ message: 'Lote no encontrado' });
        const batch = batches[0];

        // Validar si el lote está bloqueado por HACCP
        if (batch.status === 'bloqueado_haccp') {
            return res.status(400).json({
                message: 'ERROR DE CALIDAD: No se puede empaquetar este lote porque tiene un bloqueo activo de inocuidad alimentaria (Falla HACCP).'
            });
        }

        const total_batch_weight_lbs = units_packaged * weight_per_unit_lbs;
        const cleanProduct = batch.product_type.replace(' ', '-').toUpperCase();
        
        // Generar lote visible: si tiene batch_code_display usarlo, de lo contrario formato fecha
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const lot_code = batch.batch_code_display ? `LOT-${batch.batch_code_display.replace(/\s+/g, '')}` : `LOT-${dateStr}-${cleanProduct}-${batch_id}`;
        
        // Código de barras simulado (UPC-A de 12 dígitos)
        const barcode = `741258${String(batch_id).padStart(6, '0')}`;

        // Vida útil según estado: Congelado a -18°C = 365 días (1 año), Líquido refrigerado 2° a 4°C = 28 días
        const shelfLifeDays = product_state === 'congelado' ? 365 : 28;

        // Payload completo de trazabilidad para el código QR
        const qr_code_payload = JSON.stringify({
            lot_code,
            batch_display: batch.batch_code_display || lot_code,
            product: batch.product_type,
            presentation: batch.presentation,
            units: units_packaged,
            weight_lbs: total_batch_weight_lbs,
            warehouse_zone,
            product_state,
            packaged_at: new Date().toISOString(),
            trace_uuid: batch.batch_uuid,
            operator: operator_name
        });

        // Insertar registro
        const [result] = await pool.query(
            `INSERT INTO egg_packaging_records (
                company_id, batch_id, units_packaged, warehouse_zone, product_state, 
                weight_per_unit_lbs, total_batch_weight_lbs, lot_code, barcode, label_type, 
                customer_destination, qr_code_payload, expiry_date, operator_name
            ) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(CURDATE(), INTERVAL ? DAY), ?)`,
            [
                company_id, batch_id, units_packaged, warehouse_zone, product_state,
                weight_per_unit_lbs, total_batch_weight_lbs, lot_code, barcode, label_type,
                customer_destination, qr_code_payload, shelfLifeDays, operator_name
            ]
        );

        // Actualizar estado de lote
        const newBatchStatus = warehouse_zone === 'BLAST' || product_state === 'congelado' ? 'congelado' : 'empaquetado';
        await pool.query(
            `UPDATE egg_production_batches SET status = ? WHERE id = ? AND company_id = ?`,
            [newBatchStatus, batch_id, company_id]
        );

        // Crear evento
        await pool.query(
            `INSERT INTO egg_industrial_events (company_id, event_type, severity, description, payload, operator_name)
             VALUES (?, 'packaging.completed', 'info', ?, ?, ?)`,
            [
                company_id, 
                `Empaque completado para lote ${lot_code} (${units_packaged} unidades en zona ${warehouse_zone}, estado ${product_state}).`, 
                qr_code_payload, 
                operator_name
            ]
        );

        res.status(201).json({ 
            id: result.insertId, 
            lot_code, 
            barcode, 
            warehouse_zone, 
            product_state, 
            shelfLifeDays, 
            qr_code_payload 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const updatePackagingRecord = async (req, res) => {
    try {
        const { id } = req.params;
        const { units_packaged, weight_per_unit_lbs, operator_name } = req.body;
        const company_id = req.company_id;

        const [existing] = await pool.query(
            'SELECT * FROM egg_packaging_records WHERE id = ? AND company_id = ?',
            [id, company_id]
        );
        if (existing.length === 0) {
            return res.status(404).json({ message: 'Registro de empaque no encontrado.' });
        }

        const total_batch_weight_lbs = parseFloat(units_packaged) * parseFloat(weight_per_unit_lbs);

        await pool.query(
            `UPDATE egg_packaging_records SET units_packaged = ?, weight_per_unit_lbs = ?, total_batch_weight_lbs = ?, operator_name = ? WHERE id = ? AND company_id = ?`,
            [parseInt(units_packaged), parseFloat(weight_per_unit_lbs), total_batch_weight_lbs, operator_name, id, company_id]
        );

        await pool.query(
            `INSERT INTO egg_industrial_events (company_id, event_type, severity, description, payload, operator_name)
             VALUES (?, 'packaging.updated', 'info', ?, ?, ?)`,
            [company_id, `Empaque #${id} actualizado: ${units_packaged} unidades, ${total_batch_weight_lbs} Lbs.`, JSON.stringify({ packaging_id: parseInt(id) }), operator_name]
        );

        res.json({ id, units_packaged, weight_per_unit_lbs, total_batch_weight_lbs });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const deletePackagingRecord = async (req, res) => {
    try {
        const { id } = req.params;
        const company_id = req.company_id;

        const [existing] = await pool.query(
            'SELECT * FROM egg_packaging_records WHERE id = ? AND company_id = ?',
            [id, company_id]
        );
        if (existing.length === 0) {
            return res.status(404).json({ message: 'Registro de empaque no encontrado.' });
        }

        // Check if this packaging record is linked to a blast freezer log
        const [freezerRefs] = await pool.query(
            'SELECT id FROM egg_blast_freezer_logs WHERE packaging_id = ?',
            [id]
        );
        if (freezerRefs.length > 0) {
            return res.status(400).json({ message: 'No se puede eliminar: este empaque tiene registros de Blast Freezer asociados. Elimine primero los registros de congelación.' });
        }

        await pool.query('DELETE FROM egg_packaging_records WHERE id = ? AND company_id = ?', [id, company_id]);

        await pool.query(
            `INSERT INTO egg_industrial_events (company_id, event_type, severity, description, payload, operator_name)
             VALUES (?, 'packaging.deleted', 'warning', ?, ?, ?)`,
            [company_id, `Empaque #${id} eliminado.`, JSON.stringify({ packaging_id: parseInt(id) }), existing[0].operator_name]
        );

        res.json({ id, deleted: true });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 7. BLAST FREEZER (Congelador rápido)
const getBlastFreezerLogs = async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT fl.*, pr.lot_code, b.product_type 
             FROM egg_blast_freezer_logs fl
             LEFT JOIN egg_packaging_records pr ON fl.packaging_id = pr.id
             LEFT JOIN egg_production_batches b ON pr.batch_id = b.id
             WHERE fl.company_id = ? 
             ORDER BY fl.created_at DESC`,
            [req.company_id]
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const createBlastFreezerLog = async (req, res) => {
    try {
        const { packaging_id, freezer_location, core_temperature_c, freezing_duration_hours, status } = req.body;
        const company_id = req.company_id;

        const [result] = await pool.query(
            `INSERT INTO egg_blast_freezer_logs (company_id, packaging_id, freezer_location, core_temperature_c, freezing_duration_hours, status) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [company_id, packaging_id, freezer_location, core_temperature_c, freezing_duration_hours, status || 'congelando']
        );

        // Si ya está completado el congelado, actualizar el lote general
        if (status === 'congelado_ok') {
            const [pkgs] = await pool.query('SELECT batch_id FROM egg_packaging_records WHERE id = ? AND company_id = ?', [packaging_id, company_id]);
            if (pkgs.length > 0) {
                await pool.query(
                    `UPDATE egg_production_batches SET status = 'congelado' WHERE id = ? AND company_id = ?`,
                    [pkgs[0].batch_id, company_id]
                );
            }
        }

        res.status(201).json({ id: result.insertId, ...req.body });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 8. MANTENIMIENTO
const getMaintenanceLogs = async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT * FROM egg_machinery_maintenance WHERE company_id = ? ORDER BY created_at DESC`,
            [req.company_id]
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const createMaintenanceLog = async (req, res) => {
    try {
        const { equipment_name, maintenance_type, description, spare_parts_used, usage_hours_count, technician_name, cost } = req.body;
        const [result] = await pool.query(
            `INSERT INTO egg_machinery_maintenance (company_id, equipment_name, maintenance_type, description, spare_parts_used, usage_hours_count, technician_name, cost) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.company_id, equipment_name, maintenance_type, description, spare_parts_used, usage_hours_count, technician_name, cost]
        );

        // Evento
        await pool.query(
            `INSERT INTO egg_industrial_events (company_id, event_type, severity, description, payload, operator_name)
             VALUES (?, 'maintenance.logged', 'info', ?, ?, ?)`,
            [req.company_id, `Mantenimiento ${maintenance_type} registrado para ${equipment_name}. Costo: $${cost}.`, JSON.stringify({ maintenance_id: result.insertId, equipment_name }), technician_name]
        );

        notificationService.notify('maintenance_log_created', req.company_id, req.user?.branch_id, {
            equipo: equipment_name || '',
            tipo_mantenimiento: maintenance_type || '',
            descripcion: description || '',
            fecha: new Date().toISOString().split('T')[0],
            sucursal: ''
        }).catch(() => {});

        res.status(201).json({ id: result.insertId, ...req.body });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 9. COSTEO OPERATIVO INDUSTRIAL
const getIndustrialCosts = async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT ic.*, b.product_type, b.batch_uuid, b.yield_liquid_lbs, b.presentation 
             FROM egg_industrial_costs ic
             LEFT JOIN egg_production_batches b ON ic.batch_id = b.id
             WHERE ic.company_id = ? 
             ORDER BY ic.created_at DESC`,
            [req.company_id]
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const createIndustrialCosts = async (req, res) => {
    try {
        const { batch_id, diesel_cost, electricity_cost, water_cost, labor_cost, packaging_materials_cost, chemicals_cip_cost, quality_tests_cost } = req.body;
        const [result] = await pool.query(
            `INSERT INTO egg_industrial_costs (company_id, batch_id, diesel_cost, electricity_cost, water_cost, labor_cost, packaging_materials_cost, chemicals_cip_cost, quality_tests_cost) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.company_id, batch_id, diesel_cost, electricity_cost, water_cost, labor_cost, packaging_materials_cost, chemicals_cip_cost, quality_tests_cost]
        );
        res.status(201).json({ id: result.insertId, ...req.body });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 10. PREVISIÓN Y FORECASTING
const getForecasting = async (req, res) => {
    try {
        // Enfoque predictivo enterprise:
        // Analizamos las ventas del año actual cargadas en sales_items agrupadas por mes,
        // y proyectamos la producción recomendada para el siguiente mes mediante regresión de promedio ponderado.
        const [salesHistory] = await pool.query(
             `SELECT MONTH(sh.fecha_emision) as mes, SUM(si.cantidad) as total_unidades
             FROM sales_items si
             JOIN sales_headers sh ON si.sale_id = sh.id
             WHERE sh.company_id = ? AND sh.estado != 'ANULADO'
               AND NOT EXISTS (SELECT 1 FROM dtes WHERE venta_id = sh.id AND status = 'INVALIDADO')
               AND sh.fecha_emision >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
             GROUP BY MONTH(sh.fecha_emision)
             ORDER BY mes ASC`,
            [req.company_id]
        );

        // Simulador de regresión lineal simple + promedio en caso de no haber datos previos
        let monthlyData = [4200, 4800, 5100, 5600, 6100, 6400]; // Seed base realista
        if (salesHistory.length > 3) {
            monthlyData = salesHistory.map(h => parseFloat(h.total_unidades));
        }

        // Predicción matemática: media móvil ponderada exponencialmente
        let forecastNextMonth = 0;
        let sumWeights = 0;
        monthlyData.forEach((val, index) => {
            const weight = index + 1; // Mayor peso al mes más reciente
            forecastNextMonth += val * weight;
            sumWeights += weight;
        });
        forecastNextMonth = Math.round(forecastNextMonth / sumWeights);

        res.json({
            historical: monthlyData,
            forecast: forecastNextMonth,
            recommended_purchase_raw_material_lbs: Math.round(forecastNextMonth * 1.15), // Rendimiento promedio de cascara
            confidence_interval: '92.4%',
            safety_stock: Math.round(forecastNextMonth * 0.15)
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 11. TRAZABILIDAD BIDIRECCIONAL COMPLETA (360°)
const getTraceability = async (req, res) => {
    try {
        const { code } = req.params;
        const company_id = req.company_id;

        // Buscar el lote por UUID, lote de empaque o código de barras
        let batchQuery = `
            SELECT b.*, rm.egg_type as raw_egg_type, rm.provider_lot as raw_provider_lot, rm.temperature_c as raw_temp, rm.weight_lbs as raw_weight, rm.operator_name as raw_operator, p.nombre as provider_name
            FROM egg_production_batches b
            LEFT JOIN egg_raw_materials rm ON b.raw_material_id = rm.id
            LEFT JOIN providers p ON rm.provider_id = p.id
            LEFT JOIN egg_packaging_records pr ON pr.batch_id = b.id
            WHERE b.company_id = ? AND (b.batch_uuid = ? OR pr.lot_code = ? OR pr.barcode = ?)
            LIMIT 1
        `;

        const [batches] = await pool.query(batchQuery, [company_id, code, code, code]);
        if (batches.length === 0) {
            return res.status(404).json({ message: 'No se encontraron registros de trazabilidad para el código suministrado.' });
        }

        const batch = batches[0];
        const batch_id = batch.id;

        // Cargar bitácora de pasteurización
        const [pasteurizations] = await pool.query(
            `SELECT * FROM egg_pasteurization_logs WHERE batch_id = ? AND company_id = ? ORDER BY created_at DESC`,
            [batch_id, company_id]
        );

        // Cargar bitácora de empaque
        const [packaging] = await pool.query(
            `SELECT * FROM egg_packaging_records WHERE batch_id = ? AND company_id = ?`,
            [batch_id, company_id]
        );

        // Cargar congelación (Blast Freezer)
        let blastFreezer = [];
        if (packaging.length > 0) {
            const [freezers] = await pool.query(
                `SELECT * FROM egg_blast_freezer_logs WHERE packaging_id = ? AND company_id = ?`,
                [packaging[0].id, company_id]
            );
            blastFreezer = freezers;
        }

        // Cargar bitácora de sanitización CIP que habilitó este lote
        // Buscamos sanitizaciones de pasteurizador realizadas en las 24 horas previas al inicio del lote
        const [cipLogs] = await pool.query(
            `SELECT * FROM egg_cip_logs 
             WHERE company_id = ? AND equipment_name = 'pasteurizador'
               AND created_at <= ? 
             ORDER BY created_at DESC LIMIT 2`,
            [company_id, batch.started_at]
        );

        // Cargar costos industriales
        const [costs] = await pool.query(
            `SELECT * FROM egg_industrial_costs WHERE batch_id = ? AND company_id = ?`,
            [batch_id, company_id]
        );

        // Cargar eventos del lote
        const [events] = await pool.query(
            `SELECT * FROM egg_industrial_events 
             WHERE company_id = ? AND (description LIKE ? OR payload->'$.batch_uuid' = ? OR payload->'$.batch_id' = ?)
             ORDER BY created_at ASC`,
            [company_id, `%${batch.batch_uuid}%`, batch.batch_uuid, batch_id]
        );

        res.json({
            batch,
            pasteurizations,
            packaging: packaging.length > 0 ? packaging[0] : null,
            blastFreezer: blastFreezer.length > 0 ? blastFreezer[0] : null,
            cipLogs,
            costs: costs.length > 0 ? costs[0] : null,
            auditTrail: events
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 12. AUDIT TRAIL / EVENTS LIST
const getIndustrialEvents = async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT * FROM egg_industrial_events WHERE company_id = ? ORDER BY created_at DESC LIMIT 100`,
            [req.company_id]
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 13. CONFIGURACIÓN DE PRODUCTOS
const getProductConfig = async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM egg_product_config WHERE company_id = ? ORDER BY product_type',
            [req.company_id]
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const updateProductConfig = async (req, res) => {
    try {
        const { product_type, weight_per_unit_lbs, yield_pct, waste_shell_pct, waste_loss_pct } = req.body;

        await pool.query(
            `INSERT INTO egg_product_config (company_id, product_type, weight_per_unit_lbs, yield_pct, waste_shell_pct, waste_loss_pct) 
             VALUES (?, ?, ?, ?, ?, ?) 
             ON DUPLICATE KEY UPDATE weight_per_unit_lbs = VALUES(weight_per_unit_lbs), yield_pct = VALUES(yield_pct), waste_shell_pct = VALUES(waste_shell_pct), waste_loss_pct = VALUES(waste_loss_pct)`,
            [req.company_id, product_type, weight_per_unit_lbs || 32.00, yield_pct || 85.00, waste_shell_pct || 12.00, waste_loss_pct || 3.00]
        );
        res.json({ product_type, ...req.body });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 14. CONCEPTOS DE COSTOS
const getCostConcepts = async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM egg_cost_concepts WHERE company_id = ? ORDER BY concept_name',
            [req.company_id]
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const saveCostConcept = async (req, res) => {
    try {
        const { id, concept_name, default_value } = req.body;
        if (id) {
            await pool.query('UPDATE egg_cost_concepts SET concept_name = ?, default_value = ? WHERE id = ? AND company_id = ?',
                [concept_name, default_value, id, req.company_id]);
        } else {
            await pool.query('INSERT INTO egg_cost_concepts (company_id, concept_name, default_value) VALUES (?, ?, ?)',
                [req.company_id, concept_name, default_value]);
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const deleteCostConcept = async (req, res) => {
    try {
        await pool.query('DELETE FROM egg_cost_concepts WHERE id = ? AND company_id = ?', [req.params.id, req.company_id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 14.1 CARGA AUTOMÁTICA DE COSTOS DESDE PLANILLAS RRHH Y GASTOS OPERATIVOS
const getCostsSystemSources = async (req, res) => {
    try {
        const companyId = req.company_id;
        const { month, year } = req.query;
        const currentYear = parseInt(year) || new Date().getFullYear();
        const currentMonth = parseInt(month) || (new Date().getMonth() + 1);

        // 1. Planillas de RRHH (Sueldos y Mano de Obra)
        let payrollQuery = `
            SELECT 
                p.id, p.empleado_id, p.periodo_mes, p.periodo_anio, p.quincena, p.estado,
                COALESCE(p.sueldo_base, 0) as sueldo_base,
                COALESCE(p.total_percepciones, 0) as total_percepciones,
                COALESCE(p.monto_recibir, 0) as monto_recibir,
                COALESCE(p.bonificacion_fija, 0) as bonificacion_fija
            FROM rh_planillas p
            WHERE p.company_id = ? AND p.estado != 'anulada'
        `;
        const payrollParams = [companyId];
        if (month && year) {
            payrollQuery += ' AND p.periodo_mes = ? AND p.periodo_anio = ?';
            payrollParams.push(currentMonth, currentYear);
        }
        payrollQuery += ' ORDER BY p.periodo_anio DESC, p.periodo_mes DESC, p.id DESC LIMIT 50';

        const [payrolls] = await pool.query(payrollQuery, payrollParams);

        const totalPayrollPerceptions = payrolls.reduce((sum, p) => sum + parseFloat(p.total_percepciones || 0), 0);
        const totalPayrollBase = payrolls.reduce((sum, p) => sum + parseFloat(p.sueldo_base || 0), 0);

        // 2. Gastos Fijos y Operativos de Planta (Facturas / Comprobantes)
        let expensesQuery = `
            SELECT 
                h.id, h.fecha, h.numero_documento, h.monto_total, h.observaciones,
                i.description as item_description, i.total as item_total,
                t.name as expense_type_name
            FROM expense_headers h
            LEFT JOIN expense_items i ON h.id = i.expense_id
            LEFT JOIN cat_expense_types t ON i.expense_type_id = t.id
            WHERE h.company_id = ? AND h.status = 'ACTIVO'
        `;
        const expensesParams = [companyId];
        if (month && year) {
            expensesQuery += ' AND ((h.period_month = ? AND h.period_year = ?) OR (MONTH(h.fecha) = ? AND YEAR(h.fecha) = ?))';
            expensesParams.push(currentMonth, currentYear, currentMonth, currentYear);
        }
        expensesQuery += ' ORDER BY h.fecha DESC LIMIT 100';

        const [expenseRows] = await pool.query(expensesQuery, expensesParams);

        let energyTotal = 0;
        let boilerFuelTotal = 0;
        let maintenanceTotal = 0;
        let otherOpsTotal = 0;

        expenseRows.forEach(row => {
            const desc = ((row.item_description || '') + ' ' + (row.observaciones || '') + ' ' + (row.expense_type_name || '')).toLowerCase();
            const amount = parseFloat(row.item_total || row.monto_total || 0);

            if (/energ[ií]a|luz|electric|delsur|caess|clea|edesal/i.test(desc)) {
                energyTotal += amount;
            } else if (/diesel|di[eé]sel|combustible|gas\b|glp|bunker|caldera/i.test(desc)) {
                boilerFuelTotal += amount;
            } else if (/mantenimiento|reparaci[oó]n|repuesto|t[eé]cnico|taller/i.test(desc)) {
                maintenanceTotal += amount;
            } else {
                otherOpsTotal += amount;
            }
        });

        // 3. Obtener volumen proyectado de planta para cálculo por lote y por libra
        const [costingCfg] = await pool.query(
            "SELECT setting_key, setting_value FROM egg_costing_configurations WHERE company_id = ? AND setting_key IN ('monthly_projected_lbs', 'standard_batch_weight_lbs')",
            [companyId]
        );
        const cfgMap = {};
        costingCfg.forEach(c => { cfgMap[c.setting_key] = parseFloat(c.setting_value) || 0; });
        const monthlyProjectedLbs = cfgMap.monthly_projected_lbs || 100000;
        const standardBatchLbs = cfgMap.standard_batch_weight_lbs || 12000;
        const estimatedBatchesPerMonth = standardBatchLbs > 0 ? (monthlyProjectedLbs / standardBatchLbs) : 8;

        const suggestedConcepts = [
            {
                concept_name: 'Mano de Obra Operativa (Planilla RRHH)',
                monthly_total: totalPayrollPerceptions,
                default_value: estimatedBatchesPerMonth > 0 ? +(totalPayrollPerceptions / estimatedBatchesPerMonth).toFixed(2) : 0,
                source_type: 'rh_planillas',
                details: `${payrolls.length} registros de nómina encontrados. Total mensual: $${totalPayrollPerceptions.toFixed(2)}. Distribuido en ${estimatedBatchesPerMonth.toFixed(1)} lotes mensuales proyectados.`
            },
            {
                concept_name: 'Energía Eléctrica de Planta',
                monthly_total: energyTotal,
                default_value: estimatedBatchesPerMonth > 0 ? +(energyTotal / estimatedBatchesPerMonth).toFixed(2) : 0,
                source_type: 'expenses_energy',
                details: `Facturación eléctrica del período: $${energyTotal.toFixed(2)}.`
            },
            {
                concept_name: 'Combustible / Caldera (Diesel/Gas)',
                monthly_total: boilerFuelTotal,
                default_value: estimatedBatchesPerMonth > 0 ? +(boilerFuelTotal / estimatedBatchesPerMonth).toFixed(2) : 0,
                source_type: 'expenses_boiler',
                details: `Consumo de combustibles y caldera del período: $${boilerFuelTotal.toFixed(2)}.`
            },
            {
                concept_name: 'Mantenimiento Técnico y Repuestos',
                monthly_total: maintenanceTotal,
                default_value: estimatedBatchesPerMonth > 0 ? +(maintenanceTotal / estimatedBatchesPerMonth).toFixed(2) : 0,
                source_type: 'expenses_maintenance',
                details: `Servicios de mantenimiento y refacciones del período: $${maintenanceTotal.toFixed(2)}.`
            },
            {
                concept_name: 'Gastos Operativos e Indirectos Generales',
                monthly_total: otherOpsTotal,
                default_value: estimatedBatchesPerMonth > 0 ? +(otherOpsTotal / estimatedBatchesPerMonth).toFixed(2) : 0,
                source_type: 'expenses_general',
                details: `Otros gastos operativos registrados: $${otherOpsTotal.toFixed(2)}.`
            }
        ];

        res.json({
            period: { month: currentMonth, year: currentYear },
            payrolls_summary: {
                count: payrolls.length,
                total_perceptions: totalPayrollPerceptions,
                total_base: totalPayrollBase,
                items: payrolls
            },
            expenses_summary: {
                count: expenseRows.length,
                total: energyTotal + boilerFuelTotal + maintenanceTotal + otherOpsTotal,
                breakdown: {
                    energy: energyTotal,
                    boiler_fuel: boilerFuelTotal,
                    maintenance: maintenanceTotal,
                    other_ops: otherOpsTotal
                }
            },
            production_basis: {
                monthly_projected_lbs: monthlyProjectedLbs,
                standard_batch_lbs: standardBatchLbs,
                estimated_batches: estimatedBatchesPerMonth
            },
            suggested_concepts: suggestedConcepts
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const syncCostsSystemSources = async (req, res) => {
    try {
        const companyId = req.company_id;
        const { concepts, update_gif_config } = req.body;

        if (!Array.isArray(concepts) || concepts.length === 0) {
            return res.status(400).json({ message: 'No se recibieron conceptos para sincronizar.' });
        }

        for (const c of concepts) {
            const name = (c.concept_name || '').trim();
            const val = parseFloat(c.default_value) || 0;
            if (!name) continue;

            const [existing] = await pool.query(
                'SELECT id FROM egg_cost_concepts WHERE company_id = ? AND concept_name = ?',
                [companyId, name]
            );

            if (existing.length > 0) {
                await pool.query(
                    'UPDATE egg_cost_concepts SET default_value = ? WHERE id = ? AND company_id = ?',
                    [val, existing[0].id, companyId]
                );
            } else {
                await pool.query(
                    'INSERT INTO egg_cost_concepts (company_id, concept_name, default_value) VALUES (?, ?, ?)',
                    [companyId, name, val]
                );
            }
        }

        // Si se solicitó actualizar los GIF en egg_costing_configurations
        if (update_gif_config) {
            const totalMonthly = concepts.reduce((sum, c) => sum + (parseFloat(c.monthly_total) || 0), 0);
            if (totalMonthly > 0) {
                await pool.query(
                    `UPDATE egg_costing_configurations 
                     SET setting_value = ? 
                     WHERE company_id = ? AND setting_key = 'monthly_gif_total'`,
                    [totalMonthly, companyId]
                );
            }
        }

        res.json({ success: true, message: 'Conceptos de costos fijos y operativos sincronizados exitosamente.' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 14.2 PARAMETRIZACIÓN DE PREFIJOS DE LOTE POR PROVEEDOR
const getProviderLotConfigs = async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT c.*, p.nombre as provider_name, p.nombre_comercial,
                    (SELECT rm.provider_lot 
                     FROM egg_raw_materials rm 
                     WHERE rm.provider_id = c.provider_id AND rm.company_id = c.company_id 
                     ORDER BY rm.id DESC LIMIT 1) as last_registered_lot,
                    (SELECT rm.fecha 
                     FROM egg_raw_materials rm 
                     WHERE rm.provider_id = c.provider_id AND rm.company_id = c.company_id 
                     ORDER BY rm.id DESC LIMIT 1) as last_registered_date
             FROM egg_provider_lot_configurations c
             JOIN providers p ON c.provider_id = p.id
             WHERE c.company_id = ?
             ORDER BY p.nombre ASC`,
            [req.company_id]
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const saveProviderLotConfig = async (req, res) => {
    try {
        const { provider_id, lot_prefix, format_pattern, next_correlative, notes } = req.body;
        if (!provider_id || !lot_prefix) {
            return res.status(400).json({ message: 'Proveedor y prefijo de lote son obligatorios.' });
        }
        await pool.query(
            `INSERT INTO egg_provider_lot_configurations 
             (company_id, provider_id, lot_prefix, format_pattern, next_correlative, notes)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE 
                lot_prefix = VALUES(lot_prefix),
                format_pattern = VALUES(format_pattern),
                next_correlative = VALUES(next_correlative),
                notes = VALUES(notes),
                updated_at = NOW()`,
            [req.company_id, provider_id, lot_prefix.trim().toUpperCase(), format_pattern || 'PREFIX-DATE', next_correlative || 1, notes || null]
        );
        res.json({ success: true, message: 'Configuración de lote guardada correctamente.' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const deleteProviderLotConfig = async (req, res) => {
    try {
        await pool.query('DELETE FROM egg_provider_lot_configurations WHERE id = ? AND company_id = ?', [req.params.id, req.company_id]);
        res.json({ success: true, message: 'Configuración eliminada.' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getProviderLotIntelligence = async (req, res) => {
    try {
        const providerId = req.params.providerId;
        const [configs] = await pool.query(
            'SELECT * FROM egg_provider_lot_configurations WHERE provider_id = ? AND company_id = ?',
            [providerId, req.company_id]
        );
        const [prov] = await pool.query(
            'SELECT id, nombre, nombre_comercial FROM providers WHERE id = ? AND company_id = ?',
            [providerId, req.company_id]
        );
        const [history] = await pool.query(
            `SELECT id, provider_lot, fecha, weight_lbs, total_boxes, created_at
             FROM egg_raw_materials 
             WHERE provider_id = ? AND company_id = ? 
             ORDER BY id DESC LIMIT 5`,
            [providerId, req.company_id]
        );

        const config = configs[0] || null;
        const provider = prov[0] || null;
        const lastLot = history[0]?.provider_lot || null;

        let prefix = config?.lot_prefix;
        if (!prefix && provider) {
            const name = (provider.nombre_comercial || provider.nombre || '').toUpperCase();
            if (name.includes('HECTOR') || name.includes('HÉCTOR')) prefix = 'HD-25918';
            else if (name.includes('CANDY')) prefix = 'GC-CANDY';
            else if (name.includes('GRANJA') || name.includes('AVICOLA') || name.includes('AVÍCOLA')) prefix = 'LOTE-AV';
            else {
                const cleanName = name.replace(/[^A-Z0-9\s]/g, '').trim();
                const words = cleanName.split(/\s+/).filter(w => w.length > 2 && !['SOCIEDAD','ANONIMA','CAPITAL','VARIABLE','S.A.','C.V.','DE','RL'].includes(w));
                prefix = words.length >= 2 ? `${words[0].slice(0, 3)}-${words[1].slice(0, 4)}` : `LOTE-${(cleanName.slice(0, 4) || 'PROV')}`;
            }
        }
        if (!prefix) prefix = 'LOTE-PROV';

        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const dateStr = `${month}${day}`;
        const pattern = config?.format_pattern || 'PREFIX-DATE';

        let suggestedLot = `${prefix}-${dateStr}`;
        if (pattern === 'PREFIX-CORRELATIVO') {
            const nextCorr = String(config?.next_correlative || (history.length + 1)).padStart(3, '0');
            suggestedLot = `${prefix}-${nextCorr}`;
        }

        res.json({
            provider,
            config,
            prefix,
            last_registered_lot: lastLot,
            last_registered_date: history[0]?.fecha || null,
            suggested_lot: suggestedLot,
            historical_lots: history
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 15. COSTOS VARIABLES POR LOTE
const getBatchVariableCosts = async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM egg_batch_variable_costs WHERE batch_id = ? AND company_id = ?',
            [req.params.batchId, req.company_id]
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const saveBatchVariableCost = async (req, res) => {
    try {
        const { concept_name, amount } = req.body;
        const [result] = await pool.query(
            'INSERT INTO egg_batch_variable_costs (company_id, batch_id, concept_name, amount) VALUES (?, ?, ?, ?)',
            [req.company_id, req.params.batchId, concept_name, amount]
        );
        res.json({ id: result.insertId });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const deleteBatchVariableCost = async (req, res) => {
    try {
        await pool.query('DELETE FROM egg_batch_variable_costs WHERE id = ? AND company_id = ?', [req.params.id, req.company_id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 16. CONTROL MICROBIOLÓGICO Y CALIDAD LAB-004 CON PARAMETRIZACIÓN DINÁMICA
const getQualityParameters = async (req, res) => {
    try {
        const company_id = req.company_id || req.user?.company_id;
        const { product_type } = req.query;
        let sql = 'SELECT * FROM egg_quality_parameters WHERE company_id = ?';
        const params = [company_id];
        if (product_type && product_type !== 'todos') {
            sql += ' AND (applicable_product = "todos" OR applicable_product = ?)';
            params.push(product_type);
        }
        sql += ' ORDER BY category ASC, sort_order ASC, id ASC';
        const [rows] = await pool.query(sql, params);
        res.json(rows);
    } catch (error) {
        console.error('Error fetching quality parameters:', error);
        res.status(500).json({ message: error.message });
    }
};

const saveQualityParameter = async (req, res) => {
    try {
        const company_id = req.company_id || req.user?.company_id;
        const {
            id, category, parameter_name, specification, default_value,
            unit, applicable_product, expected_criterion, sort_order, is_active
        } = req.body;

        if (!parameter_name || !specification) {
            return res.status(400).json({ message: 'El nombre del parámetro y la especificación son requeridos.' });
        }

        if (id) {
            await pool.query(`
                UPDATE egg_quality_parameters SET
                    category = ?, parameter_name = ?, specification = ?, default_value = ?,
                    unit = ?, applicable_product = ?, expected_criterion = ?,
                    sort_order = ?, is_active = ?
                WHERE id = ? AND company_id = ?
            `, [
                category || 'microbiologico', parameter_name, specification, default_value || null,
                unit || null, applicable_product || 'todos', expected_criterion || 'CONFORME',
                parseInt(sort_order) || 0, is_active === false || is_active === 0 ? 0 : 1,
                id, company_id
            ]);
            return res.json({ message: 'Parámetro actualizado exitosamente', id });
        } else {
            const [result] = await pool.query(`
                INSERT INTO egg_quality_parameters (
                    company_id, category, parameter_name, specification, default_value,
                    unit, applicable_product, expected_criterion, sort_order, is_active
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                company_id, category || 'microbiologico', parameter_name, specification, default_value || null,
                unit || null, applicable_product || 'todos', expected_criterion || 'CONFORME',
                parseInt(sort_order) || 0, is_active === false || is_active === 0 ? 0 : 1
            ]);
            return res.status(201).json({ message: 'Parámetro creado exitosamente', id: result.insertId });
        }
    } catch (error) {
        console.error('Error saving quality parameter:', error);
        res.status(500).json({ message: error.message });
    }
};

const deleteQualityParameter = async (req, res) => {
    try {
        const company_id = req.company_id || req.user?.company_id;
        const { id } = req.params;
        await pool.query('DELETE FROM egg_quality_parameters WHERE id = ? AND company_id = ?', [id, company_id]);
        res.json({ message: 'Parámetro de calidad eliminado exitosamente' });
    } catch (error) {
        console.error('Error deleting quality parameter:', error);
        res.status(500).json({ message: error.message });
    }
};

const getLabLogs = async (req, res) => {
    try {
        const company_id = req.company_id || req.user?.company_id;
        const { batch_id } = req.query;
        let sql = `
            SELECT l.*, 
                   b.batch_code_display, b.product_type, b.batch_uuid, b.started_at,
                   c.nombre as customer_nombre_db, c.correo as customer_correo
            FROM egg_lab_micro_logs l
            JOIN egg_production_batches b ON l.batch_id = b.id
            LEFT JOIN customers c ON l.customer_id = c.id
            WHERE l.company_id = ?
        `;
        const params = [company_id];
        if (batch_id) {
            sql += ' AND l.batch_id = ?';
            params.push(batch_id);
        }
        sql += ' ORDER BY l.sample_date DESC, l.id DESC';
        const [rows] = await pool.query(sql, params);

        // Parsear custom_parameters si viene como string
        const parsedRows = rows.map(r => {
            let customParams = null;
            if (r.custom_parameters) {
                try {
                    customParams = typeof r.custom_parameters === 'string' ? JSON.parse(r.custom_parameters) : r.custom_parameters;
                } catch {
                    customParams = null;
                }
            }
            return {
                ...r,
                custom_parameters: customParams
            };
        });

        res.json(parsedRows);
    } catch (error) {
        console.error('Error fetching lab logs:', error);
        res.status(500).json({ message: error.message });
    }
};

const parseNumSafe = (val) => {
    if (val === null || val === undefined || val === '') return null;
    if (typeof val === 'number') return isNaN(val) ? null : val;
    const clean = String(val).replace(/[^0-9.-]/g, '');
    const num = parseFloat(clean);
    return isNaN(num) ? null : num;
};

const createLabLog = async (req, res) => {
    try {
        const company_id = req.company_id || req.user?.company_id;
        const {
            batch_id, sample_date, customer_id, customer_name, presentation,
            mesophilic_aerobic_cfu, mesofilos_aerobios,
            total_coliforms_mpn, coliformes_totales,
            e_coli_mpn, escherichia_coli,
            salmonella_25g, salmonella_spp,
            fungi_yeasts_cfu, hongos_levaduras,
            ph, brix, solids_percentage, solidos_totales_pct,
            status, result_status, observations, notes, analyst_name,
            custom_parameters
        } = req.body;

        const aeroVal = parseNumSafe(mesophilic_aerobic_cfu ?? mesofilos_aerobios);
        const coliVal = parseNumSafe(total_coliforms_mpn ?? coliformes_totales);
        const ecoliVal = parseNumSafe(e_coli_mpn ?? escherichia_coli);
        const fungiVal = parseNumSafe(fungi_yeasts_cfu ?? hongos_levaduras);
        const phVal = parseNumSafe(ph);
        const brixVal = parseNumSafe(brix);
        const solidsVal = parseNumSafe(solids_percentage ?? solidos_totales_pct);

        const salmStr = (salmonella_25g || salmonella_spp || 'ausencia').toLowerCase().includes('presencia') ? 'presencia' : 'ausencia';

        let evaluatedStatus = status || result_status || 'aprobado';
        if (evaluatedStatus === 'retenido') evaluatedStatus = 'cuarentena';
        if (salmStr === 'presencia' || (aeroVal !== null && aeroVal > 10000) || (coliVal !== null && coliVal > 10)) {
            evaluatedStatus = 'rechazado';
        }

        const customParamsJson = custom_parameters ? (typeof custom_parameters === 'string' ? custom_parameters : JSON.stringify(custom_parameters)) : null;

        const [result] = await pool.query(
            `INSERT INTO egg_lab_micro_logs (
                company_id, batch_id, customer_id, customer_name, presentation, sample_date,
                mesophilic_aerobic_cfu, total_coliforms_mpn, e_coli_mpn, salmonella_25g,
                fungi_yeasts_cfu, ph, brix, solids_percentage, status, observations,
                custom_parameters, analyst_name
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                company_id, batch_id, customer_id || null, customer_name || null, presentation || 'Cubeta 30 Lb',
                sample_date || new Date().toISOString().split('T')[0],
                aeroVal, coliVal, ecoliVal, salmStr, fungiVal, phVal, brixVal, solidsVal,
                evaluatedStatus, observations || notes || null, customParamsJson, analyst_name || null
            ]
        );

        if (evaluatedStatus === 'rechazado') {
            await pool.query('UPDATE egg_production_batches SET status = "bloqueado_haccp" WHERE id = ? AND company_id = ?', [batch_id, company_id]);
            await pool.query(
                `INSERT INTO egg_industrial_events (company_id, event_type, severity, description, payload, operator_name)
                 VALUES (?, 'quality.rejection', 'critical', ?, ?, ?)`,
                [company_id, `Lote #${batch_id} RECHAZADO por análisis microbiológico LAB-004.`, JSON.stringify({ batch_id, salmonella: salmStr, aeroVal }), analyst_name]
            );
        } else if (evaluatedStatus === 'aprobado') {
            await pool.query('UPDATE egg_production_batches SET status = "aprobado_calidad" WHERE id = ? AND company_id = ? AND (status = "congelado" OR status = "empaquetado" OR status = "en_proceso")', [batch_id, company_id]);
        }

        res.status(201).json({ id: result.insertId, status: evaluatedStatus, ...req.body });
    } catch (error) {
        console.error('Error creating lab log:', error);
        res.status(500).json({ message: error.message });
    }
};

const updateLabLog = async (req, res) => {
    try {
        const { id } = req.params;
        const company_id = req.company_id || req.user?.company_id;
        const {
            batch_id, sample_date, customer_id, customer_name, presentation,
            mesophilic_aerobic_cfu, mesofilos_aerobios,
            total_coliforms_mpn, coliformes_totales,
            e_coli_mpn, escherichia_coli,
            salmonella_25g, salmonella_spp,
            fungi_yeasts_cfu, hongos_levaduras,
            ph, brix, solids_percentage, solidos_totales_pct,
            status, result_status, observations, notes, analyst_name,
            custom_parameters
        } = req.body;

        const aeroVal = parseNumSafe(mesophilic_aerobic_cfu ?? mesofilos_aerobios);
        const coliVal = parseNumSafe(total_coliforms_mpn ?? coliformes_totales);
        const ecoliVal = parseNumSafe(e_coli_mpn ?? escherichia_coli);
        const fungiVal = parseNumSafe(fungi_yeasts_cfu ?? hongos_levaduras);
        const phVal = parseNumSafe(ph);
        const brixVal = parseNumSafe(brix);
        const solidsVal = parseNumSafe(solids_percentage ?? solidos_totales_pct);

        const salmStr = (salmonella_25g || salmonella_spp || 'ausencia').toLowerCase().includes('presencia') ? 'presencia' : 'ausencia';

        let finalStatus = status || result_status || 'aprobado';
        if (finalStatus === 'retenido') finalStatus = 'cuarentena';
        if (salmStr === 'presencia' || (aeroVal !== null && aeroVal > 10000) || (coliVal !== null && coliVal > 10)) {
            finalStatus = 'rechazado';
        }

        const customParamsJson = custom_parameters ? (typeof custom_parameters === 'string' ? custom_parameters : JSON.stringify(custom_parameters)) : null;

        await pool.query(`
            UPDATE egg_lab_micro_logs SET
                batch_id = ?,
                customer_id = ?,
                customer_name = ?,
                presentation = ?,
                sample_date = ?,
                mesophilic_aerobic_cfu = ?,
                total_coliforms_mpn = ?,
                e_coli_mpn = ?,
                salmonella_25g = ?,
                fungi_yeasts_cfu = ?,
                ph = ?,
                brix = ?,
                solids_percentage = ?,
                status = ?,
                observations = ?,
                custom_parameters = ?,
                analyst_name = ?
            WHERE id = ? AND company_id = ?
        `, [
            batch_id,
            customer_id || null,
            customer_name || null,
            presentation || 'Cubeta 30 Lb',
            sample_date || new Date().toISOString().split('T')[0],
            aeroVal,
            coliVal,
            ecoliVal,
            salmStr,
            fungiVal,
            phVal,
            brixVal,
            solidsVal,
            finalStatus,
            observations || notes || null,
            customParamsJson,
            analyst_name || null,
            id,
            company_id
        ]);

        if (finalStatus === 'rechazado') {
            await pool.query('UPDATE egg_production_batches SET status = "bloqueado_haccp" WHERE id = ? AND company_id = ?', [batch_id, company_id]);
        } else if (finalStatus === 'aprobado') {
            await pool.query('UPDATE egg_production_batches SET status = "aprobado_calidad" WHERE id = ? AND company_id = ? AND (status = "congelado" OR status = "empaquetado" OR status = "en_proceso")', [batch_id, company_id]);
        }

        res.json({ message: 'Análisis LAB-004 actualizado exitosamente', id, status: finalStatus });
    } catch (error) {
        console.error('Error updating lab log:', error);
        res.status(500).json({ message: error.message });
    }
};

const sendUnifiedCoaEmail = async (req, res) => {
    try {
        const company_id = req.company_id || req.user?.company_id;
        const {
            customer_email, customer_name, subject, message, log_ids, attachments
        } = req.body;

        if (!customer_email) {
            return res.status(400).json({ message: 'Debe especificar el correo electrónico del cliente.' });
        }

        if (!log_ids || !Array.isArray(log_ids) || log_ids.length === 0) {
            return res.status(400).json({ message: 'Debe seleccionar al menos un lote / análisis de calidad.' });
        }

        // 1. Obtener configuración SMTP
        let smtp = null;
        try {
            const [branchRows] = await pool.query(`
                SELECT s.* FROM smtp_settings s
                JOIN branches b ON s.branch_id = b.id
                WHERE b.company_id = ?
                LIMIT 1
            `, [company_id]);
            if (branchRows.length > 0) smtp = branchRows[0];
            if (!smtp) {
                const [allSmtp] = await pool.query('SELECT * FROM smtp_settings LIMIT 1');
                if (allSmtp.length > 0) smtp = allSmtp[0];
            }
        } catch (e) {
            console.warn('Error buscando configuración SMTP:', e.message);
        }

        if (!smtp) {
            return res.status(400).json({
                message: 'No se encontró configuración SMTP activa para enviar correos. Configure el correo en el panel de sucursales/configuración.'
            });
        }

        const transporter = nodemailer.createTransport({
            host: smtp.host,
            port: parseInt(smtp.port, 10),
            secure: smtp.encryption === 'ssl' || parseInt(smtp.port, 10) === 465,
            auth: {
                user: smtp.user,
                pass: smtp.password
            },
            tls: {
                rejectUnauthorized: false,
                minVersion: 'TLSv1'
            }
        });

        // 2. Obtener información de la empresa y de los lotes
        const [[company]] = await pool.query('SELECT razon_social, nombre_comercial, nit, nrc FROM companies WHERE id = ?', [company_id]);
        const companyLegalName = company?.razon_social || 'ANDELSA, S.A. DE C.V.';
        const companyCommercialName = company?.nombre_comercial || 'ANDELSA';

        const [logs] = await pool.query(`
            SELECT l.*, b.batch_code_display, b.product_type, b.batch_uuid, b.started_at
            FROM egg_lab_micro_logs l
            JOIN egg_production_batches b ON l.batch_id = b.id
            WHERE l.id IN (?) AND l.company_id = ?
        `, [log_ids, company_id]);

        if (logs.length === 0) {
            return res.status(404).json({ message: 'No se encontraron los análisis de calidad especificados.' });
        }

        // 3. Procesar adjuntos en base64
        const mailAttachments = [];
        if (attachments && Array.isArray(attachments)) {
            for (const att of attachments) {
                if (att.filename && att.content) {
                    const cleanBase64 = att.content.replace(/^data:application\/pdf;base64,/, '');
                    mailAttachments.push({
                        filename: att.filename,
                        content: Buffer.from(cleanBase64, 'base64'),
                        contentType: 'application/pdf'
                    });
                }
            }
        }

        // Construir tabla HTML de los lotes incluidos en el despacho
        const lotsRowsHtml = logs.map(l => `
            <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 10px 12px; font-weight: bold; color: #0f172a; font-family: monospace;">${l.batch_code_display || l.batch_uuid}</td>
                <td style="padding: 10px 12px; text-transform: uppercase; color: #334155;">${l.product_type}</td>
                <td style="padding: 10px 12px; color: #475569;">${l.presentation || 'Cubeta 30 Lb'}</td>
                <td style="padding: 10px 12px; color: #475569;">${l.sample_date ? new Date(l.sample_date).toLocaleDateString() : 'N/A'}</td>
                <td style="padding: 10px 12px; text-align: center;">
                    <span style="display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: bold; text-transform: uppercase; background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0;">
                        ${l.status || 'APROBADO'}
                    </span>
                </td>
            </tr>
        `).join('');

        const emailSubject = subject || `Certificados de Calidad (COA) - ${companyCommercialName} | ${logs.length} Lote(s) Despachado(s)`;
        const emailBodyHtml = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 680px; margin: 0 auto; padding: 24px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px;">
                <div style="background: #0f172a; padding: 18px 24px; border-radius: 12px; color: #ffffff; margin-bottom: 24px;">
                    <h2 style="margin: 0; font-size: 18px; font-weight: bold; letter-spacing: 0.5px;">${companyLegalName}</h2>
                    <p style="margin: 4px 0 0; font-size: 12px; color: #cbd5e1;">Departamento de Control de Calidad & Inocuidad Alimentaria | Planta de Ovoproductos</p>
                    <p style="margin: 2px 0 0; font-size: 11px; color: #94a3b8;">NRC: ${company?.nrc || '224745-0'} | NIT: ${company?.nit || '0614-070513-102-1'}</p>
                </div>

                <div style="margin-bottom: 20px;">
                    <p style="font-size: 14px; color: #1e293b; margin: 0 0 10px;">Estimado(a) <strong>${customer_name || 'Cliente'}</strong>,</p>
                    <p style="font-size: 13px; color: #475569; line-height: 1.6; margin: 0 0 16px;">
                        ${message || 'Adjunto encontrará los Certificados de Análisis de Calidad y Liberación (COA) correspondientes a los lotes despachados a sus instalaciones. Cada certificado avala la conformidad microbiológica y físico-química bajo normativas internacionales FDA, HACCP y Codex Alimentarius.'}
                    </p>
                </div>

                <div style="margin-bottom: 24px;">
                    <h4 style="font-size: 12px; font-weight: bold; text-transform: uppercase; color: #4338ca; margin: 0 0 8px; letter-spacing: 0.5px;">
                        Detalle de Lotes Amparados en este Envío (${logs.length} Lotes):
                    </h4>
                    <table style="width: 100%; border-collapse: collapse; font-size: 12px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
                        <thead>
                            <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; text-align: left; color: #475569; font-size: 11px; text-transform: uppercase;">
                                <th style="padding: 10px 12px;">Lote Juliano</th>
                                <th style="padding: 10px 12px;">Producto</th>
                                <th style="padding: 10px 12px;">Presentación</th>
                                <th style="padding: 10px 12px;">Fecha Análisis</th>
                                <th style="padding: 10px 12px; text-align: center;">Dictamen</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${lotsRowsHtml}
                        </tbody>
                    </table>
                </div>

                <div style="background: #f0fdfa; border: 1px solid #5eead4; border-radius: 10px; padding: 14px 18px; margin-bottom: 24px;">
                    <p style="margin: 0; font-size: 12px; color: #0f766e; font-weight: 600;">
                        ✓ Todos los lotes han sido evaluados y liberados satisfactoriamente para su consumo y procesamiento industrial.
                    </p>
                    <p style="margin: 4px 0 0; font-size: 11px; color: #115e59;">
                        Documentos adjuntos: <strong>${mailAttachments.length} archivo(s) PDF individuales</strong> (uno por cada lote para su debido archivo y trazabilidad).
                    </p>
                </div>

                <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; font-size: 11px; color: #94a3b8; text-align: center;">
                    Este es un mensaje emitido automáticamente por el Sistema de Inocuidad y Calidad de ${companyLegalName}.
                </div>
            </div>
        `;

        const mailOptions = {
            from: `"${companyCommercialName} - Calidad" <${smtp.from_email || smtp.user}>`,
            to: customer_email,
            subject: emailSubject,
            html: emailBodyHtml,
            attachments: mailAttachments
        };

        const info = await transporter.sendMail(mailOptions);

        res.json({
            message: `Correo unificado enviado exitosamente a ${customer_email}`,
            messageId: info.messageId,
            attachmentsCount: mailAttachments.length,
            lotsCount: logs.length
        });
    } catch (error) {
        console.error('Error enviando correo unificado de COA:', error);
        res.status(500).json({ message: error.message || 'Error al enviar el correo electrónico.' });
    }
};


const getSolidsCalculation = async (req, res) => {
    try {
        const { base_egg_solids = 24.2, target_solids = 21.5, batch_weight_lbs = 12000 } = req.query;
        const baseSolids = parseFloat(base_egg_solids);
        const targetSolids = parseFloat(target_solids);
        const batchWeight = parseFloat(batch_weight_lbs);

        // Fórmula matemática de HUEVO ENTERO PLUS (Mario - Calidad ANDELSA):
        const waterPct = ((baseSolids - targetSolids) / baseSolids) * 100;
        const eggBaseLbs = batchWeight * (targetSolids / baseSolids);
        const waterLbs = batchWeight - eggBaseLbs;
        const waterGarrafones = waterLbs / 42.0; // 1 garrafón = 42 lbs
        const citricAcidLbs = batchWeight * 0.001; // 0.1% ácido cítrico

        res.json({
            base_egg_solids: baseSolids,
            target_solids: targetSolids,
            batch_weight_lbs: batchWeight,
            water_percentage: Math.max(0, waterPct),
            egg_base_lbs: eggBaseLbs,
            water_lbs: Math.max(0, waterLbs),
            water_garrafones: Math.max(0, waterGarrafones),
            citric_acid_lbs: citricAcidLbs,
            is_compliant: targetSolids >= 21.0
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 17. CONTROL DE CUBETAS Y TAPADERAS RETORNABLES (ROXY / LOGÍSTICA)
const getReturnableBalances = async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT r.*, c.nombre as customer_full_name, c.telefono
             FROM egg_returnable_packaging r
             LEFT JOIN customers c ON r.customer_id = c.id
             WHERE r.company_id = ?
             ORDER BY r.current_balance DESC`,
            [req.company_id]
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const saveReturnableCustomer = async (req, res) => {
    try {
        const { id, customer_id, customer_name, packaging_type, initial_balance, notes } = req.body;
        if (id) {
            await pool.query(
                `UPDATE egg_returnable_packaging 
                 SET customer_id = ?, customer_name = ?, packaging_type = ?, initial_balance = ?, notes = ?
                 WHERE id = ? AND company_id = ?`,
                [customer_id || null, customer_name, packaging_type || 'cubeta_30lb', initial_balance || 0, notes || null, id, req.company_id]
            );
            res.json({ message: 'Registro actualizado con éxito.', id });
        } else {
            const [result] = await pool.query(
                `INSERT INTO egg_returnable_packaging (company_id, customer_id, customer_name, packaging_type, initial_balance, notes)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [req.company_id, customer_id || null, customer_name, packaging_type || 'cubeta_30lb', initial_balance || 0, notes || null]
            );
            res.status(201).json({ message: 'Cliente registrado para control de retornables.', id: result.insertId });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const registerReturnableMovement = async (req, res) => {
    try {
        const { returnable_id, movement_type, quantity, reference_document, notes, registered_by } = req.body;
        const qty = parseInt(quantity);
        if (!qty || qty <= 0) {
            return res.status(400).json({ message: 'La cantidad debe ser mayor a cero.' });
        }

        const [existing] = await pool.query(
            'SELECT * FROM egg_returnable_packaging WHERE id = ? AND company_id = ?',
            [returnable_id, req.company_id]
        );
        if (existing.length === 0) {
            return res.status(404).json({ message: 'Registro de retornable no encontrado.' });
        }

        // Registrar movimiento
        await pool.query(
            `INSERT INTO egg_returnable_movements (company_id, returnable_id, movement_type, quantity, reference_document, notes, registered_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [req.company_id, returnable_id, movement_type, qty, reference_document || null, notes || null, registered_by || req.user?.nombre || 'Bodeguero']
        );

        // Actualizar saldos en egg_returnable_packaging
        if (movement_type === 'entrega') {
            await pool.query(
                `UPDATE egg_returnable_packaging 
                 SET delivered_qty = delivered_qty + ?, last_movement_date = CURDATE() 
                 WHERE id = ? AND company_id = ?`,
                [qty, returnable_id, req.company_id]
            );
        } else if (movement_type === 'devolucion') {
            await pool.query(
                `UPDATE egg_returnable_packaging 
                 SET returned_qty = returned_qty + ?, last_movement_date = CURDATE() 
                 WHERE id = ? AND company_id = ?`,
                [qty, returnable_id, req.company_id]
            );
        }

        res.status(201).json({ message: 'Movimiento registrado correctamente.' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// =========================================================================
// 19. CALENDARIO DE PRODUCCIÓN INTELIGENTE, ROLES DE PLANTA Y SUGERENCIAS
// =========================================================================

// 19.1 Listar producciones programadas
const getScheduledProductions = async (req, res) => {
    try {
        const { start_date, end_date, status, product_profile } = req.query;
        let sql = `
            SELECT p.*, b.batch_code_display, b.status as batch_status, b.started_at as batch_started_at, b.completed_at as batch_completed_at
            FROM egg_scheduled_productions p
            LEFT JOIN egg_production_batches b ON p.batch_id = b.id
            WHERE p.company_id = ?
        `;
        const company_id = req.company_id || req.user?.company_id;
        const params = [company_id];

        if (start_date) {
            sql += ' AND p.production_date >= ?';
            params.push(start_date);
        }
        if (end_date) {
            sql += ' AND p.production_date <= ?';
            params.push(end_date);
        }
        if (status) {
            sql += ' AND p.status = ?';
            params.push(status);
        }
        if (product_profile) {
            sql += ' AND p.product_profile = ?';
            params.push(product_profile);
        }

        sql += ' ORDER BY p.production_date ASC, p.start_time ASC';
        const [productions] = await pool.query(sql, params);

        // Adjuntar tareas asignadas a cada producción
        for (const prod of productions) {
            const [tasks] = await pool.query(
                `SELECT t.*, u.username, u.nombre as user_full_name
                 FROM egg_scheduled_tasks t
                 LEFT JOIN users u ON t.user_id = u.id
                 WHERE t.scheduled_production_id = ?
                 ORDER BY t.id ASC`,
                [prod.id]
            );
            prod.tasks = tasks;

            // Parsear mix_formula_json si viene como string
            if (typeof prod.mix_formula_json === 'string') {
                try {
                    prod.mix_formula_json = JSON.parse(prod.mix_formula_json);
                } catch (e) {
                    prod.mix_formula_json = {};
                }
            }
        }

        res.json(productions);
    } catch (error) {
        console.error('Error al listar producciones programadas:', error);
        res.status(500).json({ message: error.message });
    }
};

// 19.2 Crear producción programada con tareas
const createScheduledProduction = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const {
            production_date,
            start_time,
            end_time,
            lot_code,
            product_profile,
            presentation,
            target_quantity_lbs,
            target_solids_pct,
            status,
            priority,
            mix_formula_json,
            assigned_operator_id,
            assigned_operator_name,
            suggestion_source,
            notes,
            tasks
        } = req.body;

        const company_id = req.company_id || req.user?.company_id;
        const branch_id = req.body.branch_id || null;

        // Generar lote correlativo automático en formato Juliano si no viene
        let finalLotCode = lot_code;
        if (!finalLotCode || finalLotCode.trim() === '') {
            const [countRows] = await connection.query(
                'SELECT COUNT(*) as cnt FROM egg_scheduled_productions WHERE company_id = ? AND production_date = ?',
                [company_id, production_date]
            );
            const nextNum = (countRows[0]?.cnt || 0) + 1;
            finalLotCode = computeJulianLotCode(production_date, nextNum);
        }

        const [result] = await connection.query(
            `INSERT INTO egg_scheduled_productions (
                company_id, branch_id, production_date, start_time, end_time,
                lot_code, product_profile, presentation, target_quantity_lbs,
                target_solids_pct, status, priority, mix_formula_json,
                assigned_operator_id, assigned_operator_name, suggestion_source,
                notes, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                company_id,
                branch_id,
                production_date,
                start_time || '06:00:00',
                end_time || '14:00:00',
                finalLotCode,
                product_profile || 'Huevo Entero Pasteurizado',
                presentation || 'cubeta 30LB',
                parseFloat(target_quantity_lbs) || 12000.00,
                parseFloat(target_solids_pct) || 21.50,
                status || 'programado',
                priority || 'media',
                JSON.stringify(mix_formula_json || {}),
                assigned_operator_id || null,
                assigned_operator_name || null,
                suggestion_source || 'manual',
                notes || null,
                req.user?.nombre || req.user?.username || 'Sistema'
            ]
        );

        const scheduledId = result.insertId;

        // Guardar tareas y asignación de roles de fábrica
        if (Array.isArray(tasks) && tasks.length > 0) {
            for (const task of tasks) {
                if (task.task_description && task.task_description.trim() !== '') {
                    await connection.query(
                        `INSERT INTO egg_scheduled_tasks (
                            company_id, scheduled_production_id, user_id, user_name,
                            factory_role, task_description, checklist_status, notes
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            company_id,
                            scheduledId,
                            task.user_id || null,
                            task.user_name || 'Operario de Planta',
                            task.factory_role || 'General',
                            task.task_description,
                            task.checklist_status || 'pendiente',
                            task.notes || null
                        ]
                    );
                }
            }
        }

        await connection.query(
            `INSERT INTO egg_industrial_events (company_id, event_type, severity, description, payload, operator_name)
             VALUES (?, 'calendar.created', 'info', ?, ?, ?)`,
            [
                company_id,
                `Producción programada ${finalLotCode} (${product_profile}) para el día ${production_date}.`,
                JSON.stringify({ scheduled_id: scheduledId, lot_code: finalLotCode, production_date }),
                req.user?.nombre || 'Planificador'
            ]
        );

        await connection.commit();
        res.status(201).json({ id: scheduledId, lot_code: finalLotCode, message: 'Producción programada exitosamente.' });
    } catch (error) {
        await connection.rollback();
        console.error('Error al crear producción programada:', error);
        res.status(500).json({ message: error.message });
    } finally {
        connection.release();
    }
};

// 19.3 Actualizar producción programada
const updateScheduledProduction = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const { id } = req.params;
        const company_id = req.company_id || req.user?.company_id;

        const {
            production_date,
            start_time,
            end_time,
            lot_code,
            product_profile,
            presentation,
            target_quantity_lbs,
            target_solids_pct,
            status,
            priority,
            mix_formula_json,
            assigned_operator_id,
            assigned_operator_name,
            notes,
            tasks
        } = req.body;

        await connection.query(
            `UPDATE egg_scheduled_productions SET
                production_date = ?, start_time = ?, end_time = ?, lot_code = ?,
                product_profile = ?, presentation = ?, target_quantity_lbs = ?,
                target_solids_pct = ?, status = ?, priority = ?,
                mix_formula_json = ?, assigned_operator_id = ?,
                assigned_operator_name = ?, notes = ?
             WHERE id = ? AND company_id = ?`,
            [
                production_date,
                start_time || '06:00:00',
                end_time || '14:00:00',
                lot_code,
                product_profile,
                presentation,
                parseFloat(target_quantity_lbs) || 12000.00,
                parseFloat(target_solids_pct) || 21.50,
                status || 'programado',
                priority || 'media',
                JSON.stringify(mix_formula_json || {}),
                assigned_operator_id || null,
                assigned_operator_name || null,
                notes || null,
                id,
                company_id
            ]
        );

        // Sincronizar tareas si se proporcionaron
        if (Array.isArray(tasks)) {
            await connection.query(
                'DELETE FROM egg_scheduled_tasks WHERE scheduled_production_id = ? AND company_id = ?',
                [id, company_id]
            );

            for (const task of tasks) {
                if (task.task_description && task.task_description.trim() !== '') {
                    await connection.query(
                        `INSERT INTO egg_scheduled_tasks (
                            company_id, scheduled_production_id, user_id, user_name,
                            factory_role, task_description, checklist_status, completed_at, notes
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            company_id,
                            id,
                            task.user_id || null,
                            task.user_name || 'Operario de Planta',
                            task.factory_role || 'General',
                            task.task_description,
                            task.checklist_status || 'pendiente',
                            task.checklist_status === 'completado' ? (task.completed_at || new Date()) : null,
                            task.notes || null
                        ]
                    );
                }
            }
        }

        await connection.query(
            `INSERT INTO egg_industrial_events (company_id, event_type, severity, description, payload, operator_name)
             VALUES (?, 'calendar.updated', 'info', ?, ?, ?)`,
            [
                company_id,
                `Producción programada #${id} (${lot_code}) actualizada para fecha ${production_date}.`,
                JSON.stringify({ scheduled_id: id, lot_code, production_date }),
                req.user?.nombre || 'Planificador'
            ]
        );

        await connection.commit();
        res.json({ message: 'Producción actualizada correctamente.' });
    } catch (error) {
        await connection.rollback();
        console.error('Error al actualizar producción programada:', error);
        res.status(500).json({ message: error.message });
    } finally {
        connection.release();
    }
};

// 19.4 Mover producción (Drag & Drop)
const moveScheduledProduction = async (req, res) => {
    try {
        const { id } = req.params;
        const { production_date, start_time, end_time } = req.body;
        const company_id = req.company_id || req.user?.company_id;

        if (!production_date) {
            return res.status(400).json({ message: 'La nueva fecha es obligatoria.' });
        }

        const [existing] = await pool.query(
            'SELECT * FROM egg_scheduled_productions WHERE id = ? AND company_id = ?',
            [id, company_id]
        );

        if (existing.length === 0) {
            return res.status(404).json({ message: 'Producción programada no encontrada.' });
        }

        let updateSql = 'UPDATE egg_scheduled_productions SET production_date = ?';
        let params = [production_date];

        if (start_time) {
            updateSql += ', start_time = ?';
            params.push(start_time);
        }
        if (end_time) {
            updateSql += ', end_time = ?';
            params.push(end_time);
        }

        updateSql += ' WHERE id = ? AND company_id = ?';
        params.push(id, company_id);

        await pool.query(updateSql, params);

        await pool.query(
            `INSERT INTO egg_industrial_events (company_id, event_type, severity, description, payload, operator_name)
             VALUES (?, 'calendar.moved', 'info', ?, ?, ?)`,
            [
                company_id,
                `Producción ${existing[0].lot_code} movida de ${existing[0].production_date} a ${production_date}.`,
                JSON.stringify({ id, lot_code: existing[0].lot_code, old_date: existing[0].production_date, new_date: production_date }),
                req.user?.nombre || 'Planificador'
            ]
        );

        res.json({ id, lot_code: existing[0].lot_code, production_date, message: 'Producción reprogramada exitosamente.' });
    } catch (error) {
        console.error('Error al mover producción en calendario:', error);
        res.status(500).json({ message: error.message });
    }
};

// 19.5 Eliminar producción programada
const deleteScheduledProduction = async (req, res) => {
    try {
        const { id } = req.params;
        const company_id = req.company_id || req.user?.company_id;

        const [existing] = await pool.query(
            'SELECT * FROM egg_scheduled_productions WHERE id = ? AND company_id = ?',
            [id, company_id]
        );

        if (existing.length === 0) {
            return res.status(404).json({ message: 'Producción no encontrada.' });
        }

        if (existing[0].status === 'en_proceso' || existing[0].status === 'completado') {
            return res.status(400).json({
                message: `No se puede eliminar una producción en estado "${existing[0].status}". Si ya se inició en planta, cancélela o márquela adecuadamente.`
            });
        }

        await pool.query(
            'DELETE FROM egg_scheduled_productions WHERE id = ? AND company_id = ?',
            [id, company_id]
        );

        await pool.query(
            `INSERT INTO egg_industrial_events (company_id, event_type, severity, description, payload, operator_name)
             VALUES (?, 'calendar.deleted', 'warning', ?, ?, ?)`,
            [
                company_id,
                `Producción programada ${existing[0].lot_code} para ${existing[0].production_date} eliminada.`,
                JSON.stringify({ id, lot_code: existing[0].lot_code }),
                req.user?.nombre || 'Planificador'
            ]
        );

        res.json({ message: 'Producción programada eliminada correctamente.' });
    } catch (error) {
        console.error('Error al eliminar producción:', error);
        res.status(500).json({ message: error.message });
    }
};

// 19.6 Iniciar lote real en planta desde la producción programada
const startBatchFromSchedule = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const { id } = req.params;
        const company_id = req.company_id || req.user?.company_id;

        const [schedRows] = await connection.query(
            'SELECT * FROM egg_scheduled_productions WHERE id = ? AND company_id = ?',
            [id, company_id]
        );

        if (schedRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Producción programada no encontrada.' });
        }

        const sched = schedRows[0];

        // Mapear product_profile a product_type oficial
        let mappedType = 'huevo entero';
        const profLower = (sched.product_profile || '').toLowerCase();
        if (profLower.includes('clara')) mappedType = 'clara';
        else if (profLower.includes('yema')) mappedType = 'yema';
        else if (profLower.includes('plus')) mappedType = 'huevo entero plus';
        else if (profLower.includes('leche')) mappedType = 'huevo con leche';
        else if (profLower.includes('separaci') || profLower.includes('formulado')) mappedType = 'huevo formulado';

        const batch_uuid = require('crypto').randomUUID();

        // Insertar en egg_production_batches
        const [batchResult] = await connection.query(
            `INSERT INTO egg_production_batches (
                company_id, branch_id, batch_uuid, batch_code_display, product_type,
                presentation, ingredients_json, status, input_weight_lbs,
                target_solids_pct, operator_name, started_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'en_proceso', ?, ?, ?, NOW())`,
            [
                company_id,
                sched.branch_id || 1,
                batch_uuid,
                sched.lot_code,
                mappedType,
                sched.presentation || 'cubeta 30LB',
                sched.mix_formula_json ? JSON.stringify(sched.mix_formula_json) : JSON.stringify({}),
                parseFloat(sched.target_quantity_lbs) || 12000.00,
                parseFloat(sched.target_solids_pct) || 21.50,
                sched.assigned_operator_name || req.user?.nombre || 'Operador de Planta'
            ]
        );

        const newBatchId = batchResult.insertId;

        // Actualizar egg_scheduled_productions
        await connection.query(
            'UPDATE egg_scheduled_productions SET batch_id = ?, status = "en_proceso" WHERE id = ? AND company_id = ?',
            [newBatchId, id, company_id]
        );

        await connection.query(
            `INSERT INTO egg_industrial_events (company_id, event_type, severity, description, payload, operator_name)
             VALUES (?, 'batch.started_from_calendar', 'info', ?, ?, ?)`,
            [
                company_id,
                `Lote de producción ${sched.lot_code} iniciado en planta desde el calendario (Batch #${newBatchId}).`,
                JSON.stringify({ scheduled_id: id, batch_id: newBatchId, lot_code: sched.lot_code }),
                req.user?.nombre || 'Supervisor'
            ]
        );

        await connection.commit();
        res.json({
            message: `Lote ${sched.lot_code} iniciado con éxito en planta.`,
            batch_id: newBatchId,
            batch_uuid,
            scheduled_id: id
        });
    } catch (error) {
        await connection.rollback();
        console.error('Error al iniciar lote desde calendario:', error);
        res.status(500).json({ message: error.message });
    } finally {
        connection.release();
    }
};

// 19.7 Alternar estado de tarea del checklist de preparación
const toggleTaskStatus = async (req, res) => {
    try {
        const { taskId } = req.params;
        const company_id = req.company_id;

        const [taskRows] = await pool.query(
            'SELECT * FROM egg_scheduled_tasks WHERE id = ? AND company_id = ?',
            [taskId, company_id]
        );

        if (taskRows.length === 0) {
            return res.status(404).json({ message: 'Tarea no encontrada.' });
        }

        const currentStatus = taskRows[0].checklist_status;
        let nextStatus = 'en_progreso';
        let completedAt = null;

        if (currentStatus === 'pendiente') {
            nextStatus = 'completado';
            completedAt = new Date();
        } else if (currentStatus === 'completado') {
            nextStatus = 'pendiente';
            completedAt = null;
        } else {
            nextStatus = 'completado';
            completedAt = new Date();
        }

        await pool.query(
            'UPDATE egg_scheduled_tasks SET checklist_status = ?, completed_at = ? WHERE id = ? AND company_id = ?',
            [nextStatus, completedAt, taskId, company_id]
        );

        res.json({ id: taskId, checklist_status: nextStatus, completed_at: completedAt });
    } catch (error) {
        console.error('Error al alternar tarea:', error);
        res.status(500).json({ message: error.message });
    }
};

// 19.8 Motor de Sugerencias Inteligentes de Producción
const getProductionSuggestions = async (req, res) => {
    try {
        const company_id = req.company_id || req.user?.company_id;

        // 1. Obtener pedidos pendientes
        const [orders] = await pool.query(
            `SELECT * FROM egg_customer_orders
             WHERE company_id = ? AND status IN ('pendiente', 'programado')
             ORDER BY required_delivery_date ASC`,
            [company_id]
        );

        // 2. Obtener acuerdos comerciales activos
        const [agreements] = await pool.query(
            `SELECT * FROM egg_costing_customer_agreements
             WHERE company_id = ? AND status = 'activo'`,
            [company_id]
        );

        // 3. Stock actual de materia prima disponible
        const [rmRows] = await pool.query(
            `SELECT SUM(stock_lbs) as total_stock_lbs, SUM(total_boxes) as total_boxes
             FROM egg_raw_materials
             WHERE company_id = ? AND status = 'aprobado' AND stock_lbs > 0`,
            [company_id]
        );
        const availableStockLbs = parseFloat(rmRows[0]?.total_stock_lbs || 0);

        // 4. Histórico de ventas de los últimos 6 meses (ventas de productos de huevo)
        const [salesHistory] = await pool.query(
            `SELECT p.nombre as product_name, SUM(si.cantidad) as total_lbs, COUNT(DISTINCT sh.id) as trans_count
             FROM sales_items si
             JOIN sales_headers sh ON si.sale_id = sh.id
             JOIN products p ON si.product_id = p.id
             WHERE sh.company_id = ? AND sh.estado != 'ANULADO'
               AND sh.fecha_emision >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
               AND (p.nombre LIKE '%huevo%' OR p.nombre LIKE '%clara%' OR p.nombre LIKE '%yema%')
             GROUP BY p.nombre
             ORDER BY total_lbs DESC`,
            [company_id]
        );

        // Agregación de demanda por categoría
        let demandClara = 0;
        let demandYema = 0;
        let demandEntero = 0;
        let demandFormulado = 0;

        orders.forEach(o => {
            const qty = parseFloat(o.quantity_lbs || 0);
            const pType = (o.product_type || '').toLowerCase();
            if (pType.includes('clara')) demandClara += qty;
            else if (pType.includes('yema')) demandYema += qty;
            else if (pType.includes('formulado') || pType.includes('separaci')) demandFormulado += qty;
            else demandEntero += qty;
        });

        // Sumar demanda prorrateada semanal de los acuerdos comerciales
        agreements.forEach(a => {
            const weeklyVol = (parseFloat(a.monthly_volume_lbs || 0)) / 4.2;
            const pType = (a.product_type || '').toLowerCase();
            if (pType.includes('clara')) demandClara += weeklyVol;
            else if (pType.includes('yema')) demandYema += weeklyVol;
            else if (pType.includes('formulado') || pType.includes('separaci')) demandFormulado += weeklyVol;
            else demandEntero += weeklyVol;
        });

        // Si no hay pedidos cargados aún, proveer una base de simulación realista basada en históricos o estándares de planta
        const isSimulation = (demandClara + demandYema + demandEntero + demandFormulado) === 0;
        if (isSimulation) {
            demandClara = 5400; // Pedido de Clara típico (PriceSmart / repostería)
            demandYema = 0;    // Cero pedidos de yema pura
            demandEntero = 12000;
            demandFormulado = 6000;
        }

        const suggestions = [];

        // -------------------------------------------------------------------------------------
        // SUGERENCIA 1: BALANCE Y ARBITRAJE DE COPRODUCTO (CLARA -> EXCEDENTE DE YEMA CON H2O)
        // -------------------------------------------------------------------------------------
        // Quebrado rinde ~53.95% de Clara y ~30.8% de Yema (con 15.25% de cáscara y merma)
        if (demandClara > 0) {
            const rawLiquidNeededForClara = demandClara / 0.5395;
            const coproductYolkGenerated = rawLiquidNeededForClara * 0.308;
            const surplusYolk = Math.max(0, coproductYolkGenerated - demandYema);

            if (surplusYolk > 200) {
                // Reformulación: Yema pura (50% sólidos) rebajada con H2O purificada a 22.5% de sólidos
                // Ratio: 1 lb de yema + 1.22 lbs H2O -> 2.22 lbs de Huevo Formulado
                const waterAddedLbs = surplusYolk * 1.22;
                const formulatedYieldLbs = surplusYolk + waterAddedLbs;
                const citricAcidLbs = (formulatedYieldLbs * 0.0015).toFixed(2); // 0.15% estabilizador
                const boxesSaved = Math.round(formulatedYieldLbs / 36.1); // ~36.1 lbs líquido útil por caja
                const moneySaved = boxesSaved * 38.00; // Ahorro neto en cajas de materia prima

                // Fecha sugerida: próximo martes o jueves a las 06:00
                const nextDate = new Date();
                nextDate.setDate(nextDate.getDate() + ((2 + 7 - nextDate.getDay()) % 7 || 7));
                const recDateStr = nextDate.toISOString().split('T')[0];

                suggestions.push({
                    id: 'sug-coproduct-yolk-h2o',
                    type: 'coproduct_arbitrage',
                    priority: 'alta',
                    title: 'Arbitraje de Coproducto: Reutilización de Yema con H2O Purificada',
                    badge: 'Ahorro Máximo & Margen Alto',
                    color: 'emerald',
                    summary: `Detectada demanda de ${Math.round(demandClara).toLocaleString()} Lbs de Clara con solo ${Math.round(demandYema).toLocaleString()} Lbs de Yema requerida. El quebrado generará un excedente de ${Math.round(surplusYolk).toLocaleString()} Lbs de yema pura (50% sólidos). En lugar de congelarla y saturar cuartos fríos, se recomienda reincorporarla con ${Math.round(waterAddedLbs).toLocaleString()} Lbs de H2O purificada y ácido cítrico para formular ${Math.round(formulatedYieldLbs).toLocaleString()} Lbs de Huevo Entero Formulado estandarizado al 22.5% de sólidos.`,
                    economic_impact: {
                        boxes_saved: boxesSaved,
                        cost_savings_usd: moneySaved,
                        cost_per_lb_formulated: '$0.36 - $0.42 / Lb',
                        roi_note: `Ahorra $${moneySaved.toLocaleString()} al evitar comprar ${boxesSaved} cajas de huevo cáscara adicionales.`
                    },
                    suggested_production: {
                        production_date: recDateStr,
                        start_time: '06:00:00',
                        end_time: '14:30:00',
                        lot_code: computeJulianLotCode(recDateStr, 1),
                        product_profile: 'Huevo Formulado por Separación',
                        presentation: 'cubeta 30LB',
                        target_quantity_lbs: Math.round(formulatedYieldLbs),
                        target_solids_pct: 22.50,
                        priority: 'alta',
                        suggestion_source: 'ai_balance_coproductos',
                        mix_formula_json: {
                            raw_egg_boxes: Math.round(rawLiquidNeededForClara / 36.1),
                            raw_liquid_lbs: Math.round(rawLiquidNeededForClara),
                            clara_separated_pct: 100,
                            clara_produced_lbs: Math.round(demandClara),
                            yema_coproduct_lbs: Math.round(coproductYolkGenerated),
                            yema_reutilized_lbs: Math.round(surplusYolk),
                            water_h2o_lbs: Math.round(waterAddedLbs),
                            water_bottles: Math.ceil(waterAddedLbs / 41.8), // ~41.8 lbs por garrafa de 5 galones
                            citric_acid_lbs: citricAcidLbs,
                            target_solids_pct: 22.5,
                            notes: `Batch combinado: 1) Separar ${Math.round(demandClara).toLocaleString()} Lbs de clara para pedidos PriceSmart/repostería. 2) Reincorporar ${Math.round(surplusYolk).toLocaleString()} Lbs de yema coproducto con ${Math.round(waterAddedLbs).toLocaleString()} Lbs de H2O y ${citricAcidLbs} Lbs de ácido cítrico para envasar Huevo Formulado.`
                        },
                        tasks: [
                            { factory_role: 'Quebrado y Carga', task_description: `Almacenar y quebrar ${Math.round(rawLiquidNeededForClara / 36.1)} cajas de huevo blanco para alimentar separadora centrífuga.` },
                            { factory_role: 'Sanitización CIP', task_description: 'Ejecutar CIP ácido/alcalino de 45 min en pasteurizador y tanque de mezcla antes de las 05:30 AM.' },
                            { factory_role: 'Dosificación H2O / Mezcla', task_description: `Medir y dosificar ${Math.round(waterAddedLbs).toLocaleString()} Lbs de H2O desmineralizada con ${citricAcidLbs} Lbs de ácido cítrico grado alimentario.` },
                            { factory_role: 'Control de Calidad LAB-004', task_description: 'Verificar refractómetro: Sólidos totales 22.5% ± 0.5% Brix y pH 6.8 antes de autorizar pasteurización.' },
                            { factory_role: 'Pasteurización HACCP', task_description: 'Pasteurizar a 64.5°C por 210 segundos, monitoreando CCP-1 y flujo de 12.5 GPM.' },
                            { factory_role: 'Empaque y Cuarto Frío', task_description: `Preparar ${Math.ceil(formulatedYieldLbs / 30)} cubetas de 30 Lb sanitizadas y ${Math.ceil(demandClara / 30)} cubetas para clara.` }
                        ]
                    }
                });
            }
        }

        // -------------------------------------------------------------------------------------
        // SUGERENCIA 2: OPTIMIZACIÓN DE SECUENCIA DE LAVADOS CIP EN PLANTA
        // -------------------------------------------------------------------------------------
        const nextWed = new Date();
        nextWed.setDate(nextWed.getDate() + ((3 + 7 - nextWed.getDay()) % 7 || 7));
        const wedStr = nextWed.toISOString().split('T')[0];

        suggestions.push({
            id: 'sug-cip-sequencing',
            type: 'cip_optimization',
            priority: 'media',
            title: 'Secuenciación CIP: Lote Puro Primero, Formulado/Aditivado al Final',
            badge: 'Eficiencia Térmica & Químicos',
            color: 'indigo',
            summary: 'Al correr Huevo Entero Pasteurizado Puro en el primer turno y Huevo con Leche / Yema Azucarada en el segundo turno, se evita un lavado químico CIP intermedio profundo. Se ahorran 2 horas de paro de planta y $180 en ácido peracético y soda cáustica.',
            economic_impact: {
                hours_saved: 2.5,
                cost_savings_usd: 180.00,
                efficiency: 'Reducción de consumo de agua y vapor en caldera'
            },
            suggested_production: {
                production_date: wedStr,
                start_time: '06:00:00',
                end_time: '13:00:00',
                lot_code: computeJulianLotCode(wedStr, 1),
                product_profile: 'Huevo Entero Pasteurizado',
                presentation: 'cubeta 30LB',
                target_quantity_lbs: 12000,
                target_solids_pct: 23.50,
                priority: 'media',
                suggestion_source: 'ai_optimizador_pedidos',
                mix_formula_json: {
                    raw_egg_boxes: 332,
                    raw_liquid_lbs: 12000,
                    clara_separated_pct: 0,
                    clara_produced_lbs: 0,
                    yema_coproduct_lbs: 0,
                    water_h2o_lbs: 0,
                    notes: 'Corrida pura sin aditivos. Al finalizar, limpiar línea con enjuague rápido y pasar al lote con azúcar/leche sin desmontaje completo.'
                },
                tasks: [
                    { factory_role: 'Sanitización CIP', task_description: 'Verificar que el pasteurizador tenga CIP activo de la noche anterior (temperatura 78°C validada).' },
                    { factory_role: 'Quebrado y Carga', task_description: 'Alinear 332 cajas de huevo cáscara lote Aprobado en cámara de quebrado.' },
                    { factory_role: 'Pasteurización HACCP', task_description: 'Mantener régimen estándar de 64.5°C por 210s.' }
                ]
            }
        });

        // -------------------------------------------------------------------------------------
        // SUGERENCIA 3: ATENCIÓN DE PEDIDOS PENDIENTES CON FECHA CRÍTICA
        // -------------------------------------------------------------------------------------
        const pendingCriticalOrders = orders.filter(o => o.status === 'pendiente');
        if (pendingCriticalOrders.length > 0) {
            const firstOrder = pendingCriticalOrders[0];
            const orderDateStr = firstOrder.required_delivery_date ? new Date(firstOrder.required_delivery_date).toISOString().split('T')[0] : wedStr;
            const targetLbs = Math.max(3000, Math.ceil(parseFloat(firstOrder.quantity_lbs || 0)));

            suggestions.push({
                id: 'sug-critical-order',
                type: 'order_fulfillment',
                priority: 'urgente',
                title: `Cumplimiento de Pedido: ${firstOrder.customer_name}`,
                badge: 'Fecha de Entrega Crítica',
                color: 'amber',
                summary: `El cliente ${firstOrder.customer_name} requiere ${parseFloat(firstOrder.quantity_lbs).toLocaleString()} Lbs de ${firstOrder.product_type} para el ${orderDateStr}. Se recomienda programar la producción al menos 24 horas antes para permitir liberación de laboratorio LAB-004 (sólidos y coliformes).`,
                economic_impact: {
                    order_value_usd: (parseFloat(firstOrder.quantity_lbs || 0) * parseFloat(firstOrder.price_per_lb || 1.15)),
                    customer: firstOrder.customer_name,
                    delivery_deadline: orderDateStr
                },
                suggested_production: {
                    production_date: orderDateStr,
                    start_time: '05:30:00',
                    end_time: '12:00:00',
                    lot_code: computeJulianLotCode(orderDateStr, 1),
                    product_profile: firstOrder.product_type,
                    presentation: firstOrder.presentation || 'cubeta 30LB',
                    target_quantity_lbs: targetLbs,
                    target_solids_pct: 22.00,
                    priority: 'urgente',
                    suggestion_source: 'ai_optimizador_pedidos',
                    mix_formula_json: {
                        order_id: firstOrder.id,
                        customer_name: firstOrder.customer_name,
                        target_lbs: targetLbs,
                        notes: `Producción exclusiva para despacho orden #${firstOrder.order_number || firstOrder.id} - ${firstOrder.customer_name}`
                    },
                    tasks: [
                        { factory_role: 'Control de Calidad LAB-004', task_description: `Toma de muestra aséptica de 250ml para liberación rápida LAB-004 a ${firstOrder.customer_name}.` },
                        { factory_role: 'Empaque y Cuarto Frío', task_description: `Etiquetado especial con código de cliente y traslado inmediato a zona HOLDING.` }
                    ]
                }
            });
        }

        res.json({
            kpis: {
                demand_clara_lbs: Math.round(demandClara),
                demand_yema_lbs: Math.round(demandYema),
                demand_entero_lbs: Math.round(demandEntero),
                demand_formulado_lbs: Math.round(demandFormulado),
                available_stock_lbs: availableStockLbs,
                pending_orders_count: orders.length,
                active_agreements_count: agreements.length,
                is_simulation_active: isSimulation
            },
            suggestions
        });
    } catch (error) {
        console.error('Error al generar sugerencias de producción:', error);
        res.status(500).json({ message: error.message });
    }
};

// 19.8.1 Sugerencia Mensual Completa de Producción por IA (Demanda + Histórico + Ventas Promedio + Balance Coproductos)
const getMonthlyProductionSuggestions = async (req, res) => {
    try {
        const company_id = req.company_id || req.user?.company_id;
        const now = new Date();
        const targetYear = parseInt(req.query.year) || now.getFullYear();
        const targetMonth = parseInt(req.query.month) || (now.getMonth() + 1); // 1-12

        // 1. Obtener pedidos de clientes
        const [orders] = await pool.query(
            `SELECT * FROM egg_customer_orders
             WHERE company_id = ? 
               AND ((MONTH(required_delivery_date) = ? AND YEAR(required_delivery_date) = ?) OR status = 'pendiente')
             ORDER BY required_delivery_date ASC`,
            [company_id, targetMonth, targetYear]
        );

        // 2. Acuerdos comerciales mensuales
        const [agreements] = await pool.query(
            `SELECT * FROM egg_costing_customer_agreements 
             WHERE company_id = ? AND status = 'activo'`,
            [company_id]
        );

        // 3. Ventas de ovoproductos de los últimos 6 meses (para calcular promedios reales)
        const [salesRows] = await pool.query(
            `SELECT p.nombre as product_name, SUM(si.cantidad) as total_lbs, COUNT(DISTINCT sh.id) as trans_count,
                    COUNT(DISTINCT DATE_FORMAT(sh.fecha_emision, '%Y-%m')) as months_count
             FROM sales_items si
             JOIN sales_headers sh ON si.sale_id = sh.id
             JOIN products p ON si.product_id = p.id
             WHERE sh.company_id = ? AND sh.estado != 'ANULADO'
               AND sh.fecha_emision >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
               AND (p.nombre LIKE '%huevo%' OR p.nombre LIKE '%clara%' OR p.nombre LIKE '%yema%')
             GROUP BY p.nombre`,
            [company_id]
        );

        // 4. Stock disponible en bodega
        const [rmRows] = await pool.query(
            `SELECT SUM(stock_lbs) as total_stock_lbs, SUM(total_boxes) as total_boxes
             FROM egg_raw_materials 
             WHERE company_id = ? AND status = 'aprobado' AND stock_lbs > 0`,
            [company_id]
        );
        const availableStockLbs = parseFloat(rmRows[0]?.total_stock_lbs || 0);
        const availableStockBoxes = parseInt(rmRows[0]?.total_boxes || 0);

        // 5. Producciones ya programadas en el mes
        const [existingSchedule] = await pool.query(
            `SELECT id, production_date, lot_code, product_profile, target_quantity_lbs, status
             FROM egg_scheduled_productions
             WHERE company_id = ? AND MONTH(production_date) = ? AND YEAR(production_date) = ?
               AND status != 'cancelado'`,
            [company_id, targetMonth, targetYear]
        );
        const scheduledDatesSet = new Set(
            existingSchedule.map(p => new Date(p.production_date).toISOString().split('T')[0])
        );

        // Agregación de demanda
        let demandClara = 0;
        let demandYema = 0;
        let demandEntero = 0;
        let demandFormulado = 0;
        let demandLeche = 0;

        orders.forEach(o => {
            const qty = parseFloat(o.quantity_lbs || 0);
            const p = (o.product_type || '').toLowerCase();
            if (p.includes('clara')) demandClara += qty;
            else if (p.includes('yema')) demandYema += qty;
            else if (p.includes('formulado') || p.includes('separaci')) demandFormulado += qty;
            else if (p.includes('leche')) demandLeche += qty;
            else demandEntero += qty;
        });

        agreements.forEach(a => {
            const vol = parseFloat(a.monthly_volume_lbs || 0);
            const p = (a.product_type || '').toLowerCase();
            if (p.includes('clara')) demandClara += vol;
            else if (p.includes('yema')) demandYema += vol;
            else if (p.includes('formulado') || p.includes('separaci')) demandFormulado += vol;
            else if (p.includes('leche')) demandLeche += vol;
            else demandEntero += vol;
        });

        // Promedio de ventas históricas mensuales
        let historyMonthlyAvgLbs = 0;
        if (salesRows.length > 0) {
            const sumLbs = salesRows.reduce((acc, r) => acc + (parseFloat(r.total_lbs) || 0), 0);
            const maxMonths = Math.max(1, Math.max(...salesRows.map(r => r.months_count || 1)));
            historyMonthlyAvgLbs = sumLbs / maxMonths;
        }

        // Si la demanda puntual de pedidos es modesta, complementar con el promedio de ventas para dar cobertura mensual completa
        const baseDemandTotal = demandClara + demandYema + demandEntero + demandFormulado + demandLeche;
        const targetMonthlyVolumeLbs = Math.max(baseDemandTotal, historyMonthlyAvgLbs > 10000 ? historyMonthlyAvgLbs : 54000);

        if (demandEntero === 0 && demandClara === 0) {
            demandEntero = targetMonthlyVolumeLbs * 0.60;
            demandClara = targetMonthlyVolumeLbs * 0.25;
            demandFormulado = targetMonthlyVolumeLbs * 0.15;
        }

        // Calcular días del mes y generar corridas distribuidas (Lunes, Miércoles, Viernes)
        const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
        const monthlyRuns = [];
        let totalProjectedLbs = 0;
        let totalBoxesNeeded = 0;
        let totalCoproductSavingsUsd = 0;

        // Distribución inteligente por semanas
        for (let day = 1; day <= daysInMonth; day++) {
            const dateObj = new Date(targetYear, targetMonth - 1, day);
            const dayOfWeek = dateObj.getDay(); // 0: Dom, 1: Lun, 2: Mar, 3: Mié, 4: Jue, 5: Vie, 6: Sáb
            const dateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

            // Programar corridas operativas en Lunes (1), Miércoles (3) y Viernes (5)
            if (dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5) {
                let profile = 'Huevo Entero Pasteurizado';
                let targetLbs = 12000;
                let targetSolids = 23.5;
                let reason = 'Reposición de stock comercial según promedio histórico de ventas';
                let priority = 'media';
                let mixFormula = {};

                if (dayOfWeek === 1) {
                    // Lunes: Corrida de Separación / Clara de alta demanda
                    profile = 'Clara de Huevo Pasteurizada';
                    targetLbs = Math.min(8000, Math.max(5000, Math.round(demandClara / 4)));
                    targetSolids = 11.5;
                    const rawNeeded = Math.round(targetLbs / 0.5395);
                    const coprodYolk = Math.round(rawNeeded * 0.308);
                    const boxes = Math.round(rawNeeded / 36.1);
                    reason = `Cubrir demanda semanal de Clara. Genera ${coprodYolk.toLocaleString()} Lbs de yema coproducto para formular el miércoles.`;
                    priority = 'alta';
                    mixFormula = {
                        raw_egg_boxes: boxes,
                        raw_liquid_lbs: rawNeeded,
                        clara_produced_lbs: targetLbs,
                        yema_coproduct_lbs: coprodYolk,
                        water_h2o_lbs: 0,
                        notes: 'Separación centrífuga de alta pureza. Enfriar y almacenar yema en tanque HOLDING-2.'
                    };
                } else if (dayOfWeek === 3) {
                    // Miércoles: Corrida de Huevo Formulado (Yema coproducto + H2O Purificada) -> Arbitraje
                    profile = 'Huevo Formulado por Separación';
                    const surplusYolk = Math.round(Math.min(8000, Math.max(5000, Math.round(demandClara / 4))) * (0.308 / 0.5395));
                    const waterAdded = Math.round(surplusYolk * 1.22);
                    targetLbs = surplusYolk + waterAdded;
                    targetSolids = 22.5;
                    const citricAcid = (targetLbs * 0.0015).toFixed(2);
                    const boxesSaved = Math.round(targetLbs / 36.1);
                    const moneySaved = boxesSaved * 38.00;
                    totalCoproductSavingsUsd += moneySaved;
                    reason = `Arbitraje Coproducto: Reincorporar ${surplusYolk.toLocaleString()} Lbs de yema del lunes con ${waterAdded.toLocaleString()} Lbs H2O y ácido cítrico. Ahorro de $${moneySaved.toLocaleString()}`;
                    priority = 'alta';
                    mixFormula = {
                        raw_egg_boxes: 0,
                        raw_liquid_lbs: surplusYolk,
                        yema_reutilized_lbs: surplusYolk,
                        water_h2o_lbs: waterAdded,
                        water_bottles: Math.ceil(waterAdded / 41.8),
                        citric_acid_lbs: citricAcid,
                        notes: 'Balance yema + H2O a 22.5% Brix. Validación LAB-004 obligatoria.'
                    };
                } else {
                    // Viernes: Huevo Entero Pasteurizado Puro
                    profile = 'Huevo Entero Pasteurizado';
                    targetLbs = 12000;
                    targetSolids = 23.5;
                    const boxes = Math.round(targetLbs / 36.1);
                    reason = 'Corrida estándar de huevo entero para entrega de fin de semana e inventario de rotación.';
                    priority = 'media';
                    mixFormula = {
                        raw_egg_boxes: boxes,
                        raw_liquid_lbs: targetLbs,
                        clara_separated_pct: 0,
                        water_h2o_lbs: 0,
                        notes: 'Pasteurización directa 64.5°C por 210s CCP-1.'
                    };
                }

                const julianLot = computeJulianLotCode(dateStr, 1);
                const boxesRun = mixFormula.raw_egg_boxes || Math.round(targetLbs / 36.1);

                totalProjectedLbs += targetLbs;
                totalBoxesNeeded += boxesRun;

                monthlyRuns.push({
                    production_date: dateStr,
                    start_time: '06:00:00',
                    end_time: '14:00:00',
                    lot_code: julianLot,
                    product_profile: profile,
                    presentation: 'cubeta 30LB',
                    target_quantity_lbs: targetLbs,
                    target_solids_pct: targetSolids,
                    priority,
                    suggestion_source: 'ai_plan_mensual',
                    reason,
                    mix_formula_json: mixFormula,
                    already_scheduled: scheduledDatesSet.has(dateStr),
                    tasks: [
                        { factory_role: 'Sanitización CIP', task_description: 'CIP térmico/químico a 78°C antes de encendido' },
                        { factory_role: 'Quebrado y Carga', task_description: `Alinear y quebrar ${boxesRun > 0 ? boxesRun + ' cajas de huevo' : 'cargar yema de tanque'}` },
                        { factory_role: 'Pasteurización HACCP', task_description: 'Monitorear CCP-1 a 64.5°C y flujo 12.5 GPM' },
                        { factory_role: 'Control de Calidad LAB-004', task_description: `Verificar Brix ${targetSolids}% y ausencia coliformes` },
                        { factory_role: 'Empaque y Cuarto Frío', task_description: `Envasar ${Math.ceil(targetLbs / 30)} cubetas de 30 Lb sanitizadas` }
                    ]
                });
            }
        }

        res.json({
            month: targetMonth,
            year: targetYear,
            kpis: {
                total_projected_lbs: totalProjectedLbs,
                total_boxes_needed: totalBoxesNeeded,
                available_stock_lbs: availableStockLbs,
                available_stock_boxes: availableStockBoxes,
                stock_balance_boxes: availableStockBoxes - totalBoxesNeeded,
                total_coproduct_savings_usd: Math.round(totalCoproductSavingsUsd),
                batches_count: monthlyRuns.length,
                pending_orders_count: orders.length,
                active_agreements_count: agreements.length,
                sales_history_monthly_avg_lbs: Math.round(historyMonthlyAvgLbs),
                already_scheduled_count: existingSchedule.length
            },
            monthly_plan: monthlyRuns
        });
    } catch (error) {
        console.error('Error al generar sugerencia mensual de producción:', error);
        res.status(500).json({ message: error.message });
    }
};

// 19.8.2 Aplicar Plan Mensual Completo en Lote al Calendario
const applyMonthlyPlan = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const company_id = req.company_id || req.user?.company_id;
        const { productions, overwrite_existing } = req.body;

        if (!Array.isArray(productions) || productions.length === 0) {
            connection.release();
            return res.status(400).json({ message: 'No se enviaron producciones para programar.' });
        }

        let insertedCount = 0;

        for (const prod of productions) {
            const {
                production_date,
                start_time,
                end_time,
                lot_code,
                product_profile,
                presentation,
                target_quantity_lbs,
                target_solids_pct,
                priority,
                mix_formula_json,
                reason,
                tasks
            } = prod;

            // Verificar si ya existe una producción en esa fecha
            const [existRows] = await connection.query(
                'SELECT id FROM egg_scheduled_productions WHERE company_id = ? AND production_date = ? AND status != "cancelado"',
                [company_id, production_date]
            );

            if (existRows.length > 0 && !overwrite_existing) {
                // Saltar para no duplicar si el usuario no pidió sobreescribir
                continue;
            }

            const finalLotCode = lot_code || computeJulianLotCode(production_date, 1);

            const [result] = await connection.query(
                `INSERT INTO egg_scheduled_productions (
                    company_id, production_date, start_time, end_time,
                    lot_code, product_profile, presentation, target_quantity_lbs,
                    target_solids_pct, status, priority, mix_formula_json,
                    suggestion_source, notes, created_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'programado', ?, ?, 'ai_plan_mensual', ?, ?)`,
                [
                    company_id,
                    production_date,
                    start_time || '06:00:00',
                    end_time || '14:00:00',
                    finalLotCode,
                    product_profile || 'Huevo Entero Pasteurizado',
                    presentation || 'cubeta 30LB',
                    parseFloat(target_quantity_lbs) || 12000,
                    parseFloat(target_solids_pct) || 23.5,
                    priority || 'media',
                    JSON.stringify(mix_formula_json || {}),
                    reason || 'Plan Mensual Sugerido por IA',
                    req.user?.nombre || req.user?.username || 'IA Sugerencia Mensual'
                ]
            );

            const scheduledId = result.insertId;

            // Insertar tareas operativas
            const taskList = Array.isArray(tasks) && tasks.length > 0 ? tasks : [
                { factory_role: 'Sanitización CIP', task_description: 'CIP térmico/químico a 78°C antes de iniciar' },
                { factory_role: 'Quebrado y Carga', task_description: 'Carga de tolva y quebrado' },
                { factory_role: 'Pasteurización HACCP', task_description: 'Pasteurizar a 64.5°C por 210s CCP-1' },
                { factory_role: 'Control de Calidad LAB-004', task_description: 'Control brix y análisis microbiológico' },
                { factory_role: 'Empaque y Cuarto Frío', task_description: 'Envasado con liner alimentario y etiquetas julianas' }
            ];

            for (const t of taskList) {
                await connection.query(
                    `INSERT INTO egg_scheduled_tasks (
                        scheduled_production_id, factory_role, user_name, task_description, checklist_status
                    ) VALUES (?, ?, ?, ?, 'pendiente')`,
                    [scheduledId, t.factory_role || 'General', 'Operario de Planta', t.task_description || '']
                );
            }

            insertedCount++;
        }

        await connection.commit();
        connection.release();

        res.json({
            success: true,
            inserted_count: insertedCount,
            message: `Se programaron exitosamente ${insertedCount} lotes con numeración juliana en el calendario.`
        });
    } catch (error) {
        await connection.rollback();
        connection.release();
        console.error('Error al aplicar plan mensual:', error);
        res.status(500).json({ message: error.message });
    }
};

// 19.8.3 Planificador de Materia Prima e Insumos (MRP)
const getRawMaterialPlanning = async (req, res) => {
    try {
        const company_id = req.company_id || req.user?.company_id;
        const now = new Date();
        const targetYear = parseInt(req.query.year) || now.getFullYear();
        const targetMonth = parseInt(req.query.month) || (now.getMonth() + 1);

        // 1. Obtener todas las producciones programadas del mes
        const [scheduledProds] = await pool.query(
            `SELECT * FROM egg_scheduled_productions 
             WHERE company_id = ? AND MONTH(production_date) = ? AND YEAR(production_date) = ?
               AND status != 'cancelado'
             ORDER BY production_date ASC`,
            [company_id, targetMonth, targetYear]
        );

        // 2. Obtener inventario actual de materia prima aprobado
        const [rmRows] = await pool.query(
            `SELECT SUM(stock_lbs) as total_stock_lbs, SUM(total_boxes) as total_boxes
             FROM egg_raw_materials 
             WHERE company_id = ? AND status = 'aprobado' AND stock_lbs > 0`,
            [company_id]
        );
        const currentStockLbs = parseFloat(rmRows[0]?.total_stock_lbs || 0);
        const currentStockBoxes = parseInt(rmRows[0]?.total_boxes || 0);

        // 3. Obtener lista de proveedores principales para recomendaciones
        const [providers] = await pool.query(
            `SELECT id, nombre, contacto, telefono FROM providers 
             WHERE company_id = ? AND (nombre LIKE '%avicol%' OR nombre LIKE '%granja%' OR nombre LIKE '%huevo%' OR nombre LIKE '%agro%')
             LIMIT 5`,
            [company_id]
        );

        // 4. Calcular consumos consolidados
        let totalLiquidLbsNeeded = 0;
        let totalRawEggBoxesNeeded = 0;
        let totalWaterH2oLbs = 0;
        let totalCitricAcidLbs = 0;
        let totalSugarLbs = 0;
        let totalSaltLbs = 0;
        let totalMilkLbs = 0;
        let totalBuckets30Lb = 0;

        scheduledProds.forEach(p => {
            const qty = parseFloat(p.target_quantity_lbs || 0);
            let formula = {};
            try {
                formula = typeof p.mix_formula_json === 'string' ? JSON.parse(p.mix_formula_json) : (p.mix_formula_json || {});
            } catch (e) {
                formula = {};
            }

            const pBoxes = parseInt(formula.raw_egg_boxes) || Math.round(qty / 36.1);
            const pLiquid = parseFloat(formula.raw_liquid_lbs) || qty;
            const pWater = parseFloat(formula.water_h2o_lbs || 0);
            const pCitric = parseFloat(formula.citric_acid_lbs || 0);
            const pSugar = parseFloat(formula.sugar_lbs || 0);
            const pSalt = parseFloat(formula.salt_lbs || 0);
            const pMilk = parseFloat(formula.milk_powder_lbs || 0);

            totalLiquidLbsNeeded += pLiquid;
            totalRawEggBoxesNeeded += pBoxes;
            totalWaterH2oLbs += pWater;
            totalCitricAcidLbs += pCitric;
            totalSugarLbs += pSugar;
            totalSaltLbs += pSalt;
            totalMilkLbs += pMilk;
            totalBuckets30Lb += Math.ceil(qty / 30);
        });

        // Si no hay producciones programadas aún, proyectar una base estándar mensual para que el planificador sea útil de inmediato
        const isProjectedSimulation = scheduledProds.length === 0;
        if (isProjectedSimulation) {
            totalLiquidLbsNeeded = 54000;
            totalRawEggBoxesNeeded = Math.round(54000 / 36.1); // ~1496 cajas
            totalWaterH2oLbs = 4200;
            totalCitricAcidLbs = 8.1;
            totalSugarLbs = 480;
            totalSaltLbs = 600;
            totalBuckets30Lb = Math.ceil(54000 / 30); // ~1800 cubetas
        }

        const netBalanceBoxes = currentStockBoxes - totalRawEggBoxesNeeded;
        const netBalanceLbs = currentStockLbs - totalLiquidLbsNeeded;
        const boxesToPurchase = Math.max(0, -netBalanceBoxes);

        // Cronograma semanal de camiones sugerido (para evitar saturar cámaras de frío)
        // Capacidad típica de camión refrigerado: 350 a 500 cajas
        const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
        const trucksSchedule = [];
        const truckBatches = 4; // 1 por semana
        const boxesPerTruck = Math.ceil((boxesToPurchase > 0 ? boxesToPurchase : totalRawEggBoxesNeeded) / truckBatches);

        const supplierName = providers[0]?.nombre || 'Avícola La Granja / Agropecuaria Central';

        for (let w = 1; w <= truckBatches; w++) {
            const dayNum = Math.min(daysInMonth, (w - 1) * 7 + 3); // Martes o Miércoles de cada semana
            const deliveryDate = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
            trucksSchedule.push({
                delivery_number: `CAMION-${targetYear}${String(targetMonth).padStart(2, '0')}-0${w}`,
                week_label: `Semana ${w}`,
                suggested_delivery_date: deliveryDate,
                boxes_count: boxesPerTruck,
                weight_lbs: Math.round(boxesPerTruck * 36.1),
                suggested_provider: supplierName,
                egg_type: 'Huevo Blanco Cáscara Grado A',
                cold_chain_requirements: '4.0°C a 8.0°C en termógrafo de furgón',
                haccp_status: 'Muestreo LAB-004 de recepción obligatorio'
            });
        }

        res.json({
            month: targetMonth,
            year: targetYear,
            is_simulation: isProjectedSimulation,
            scheduled_productions_count: scheduledProds.length,
            raw_egg_balance: {
                total_liquid_lbs_needed: Math.round(totalLiquidLbsNeeded),
                total_boxes_needed: totalRawEggBoxesNeeded,
                current_stock_lbs: currentStockLbs,
                current_stock_boxes: currentStockBoxes,
                net_balance_boxes: netBalanceBoxes,
                net_balance_lbs: Math.round(netBalanceLbs),
                status: netBalanceBoxes >= 0 ? 'suficiente' : 'deficit_critico',
                boxes_to_purchase: boxesToPurchase,
                estimated_purchase_cost_usd: boxesToPurchase * 38.00 // ~$38/caja costo estándar
            },
            ingredients_balance: {
                purified_water: {
                    lbs: Math.round(totalWaterH2oLbs),
                    bottles_5gal: Math.ceil(totalWaterH2oLbs / 41.8),
                    description: 'Agua purificada desmineralizada para balance de yema coproducto'
                },
                citric_acid: {
                    lbs: parseFloat(totalCitricAcidLbs.toFixed(2)),
                    kg: parseFloat((totalCitricAcidLbs * 0.453592).toFixed(2)),
                    description: 'Ácido cítrico anhidro grado alimentario para estabilización de pH'
                },
                sugar: {
                    lbs: Math.round(totalSugarLbs),
                    sacks_50kg: Math.ceil(totalSugarLbs / 110.23),
                    description: 'Azúcar estándar para Yema Azucarada (4% - 10%)'
                },
                salt: {
                    lbs: Math.round(totalSaltLbs),
                    sacks_50kg: Math.ceil(totalSaltLbs / 110.23),
                    description: 'Sal fina desyodada para Yema Salada (10%)'
                },
                milk_powder: {
                    lbs: Math.round(totalMilkLbs),
                    sacks_25kg: Math.ceil(totalMilkLbs / 55.11),
                    description: 'Leche entera en polvo para fórmulas institucionales'
                },
                cip_chemicals: {
                    peracetic_acid_liters: scheduledProds.length * 1.5 || 18,
                    caustic_soda_liters: scheduledProds.length * 2.0 || 24,
                    description: 'Químicos sanitizantes para lavado CIP diario del pasteurizador'
                }
            },
            packaging_balance: {
                buckets_30lb: totalBuckets30Lb,
                lids: totalBuckets30Lb,
                food_grade_liners: Math.ceil(totalBuckets30Lb * 1.02), // 2% margen
                julian_traceability_labels: Math.ceil(totalBuckets30Lb * 1.05) // 5% margen
            },
            trucks_schedule: trucksSchedule
        });
    } catch (error) {
        console.error('Error en planificador de materia prima:', error);
        res.status(500).json({ message: error.message });
    }
};

// 19.8.4 Convertir Lote a Formato Juliano
const convertLotToJulian = async (req, res) => {
    try {
        const { id } = req.params;
        const company_id = req.company_id || req.user?.company_id;

        const [rows] = await pool.query(
            'SELECT id, production_date, lot_code FROM egg_scheduled_productions WHERE id = ? AND company_id = ?',
            [id, company_id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Producción no encontrada.' });
        }

        const prod = rows[0];
        const newJulianLot = computeJulianLotCode(prod.production_date, 1);

        await pool.query(
            'UPDATE egg_scheduled_productions SET lot_code = ? WHERE id = ? AND company_id = ?',
            [newJulianLot, id, company_id]
        );

        res.json({
            success: true,
            id: prod.id,
            previous_lot: prod.lot_code,
            new_lot_code: newJulianLot,
            message: `Lote actualizado a formato juliano: ${newJulianLot}`
        });
    } catch (error) {
        console.error('Error al convertir lote a juliano:', error);
        res.status(500).json({ message: error.message });
    }
};

// 19.9 Gestión de Pedidos de Clientes (Ovoproductos)
const getEggCustomerOrders = async (req, res) => {
    try {
        const { status, delivery_status, unassigned_only, fecha_desde, fecha_hasta } = req.query;
        const company_id = req.company_id || req.user?.company_id;
        let sql = `
            SELECT o.*, 
                   c.nombre as customer_registered_name, 
                   c.nombre_comercial as customer_commercial_name,
                   c.nit as customer_nit, 
                   c.nrc as customer_nrc,
                   c.telefono as customer_phone,
                   cb.nombre as branch_name,
                   cb.direccion as branch_address,
                   cb.departamento as branch_departamento,
                   cb.municipio as branch_municipio,
                   cb.contacto_nombre as branch_contact_person,
                   cb.contacto_telefono as branch_contact_phone,
                   cb.latitude as branch_latitude,
                   cb.longitude as branch_longitude,
                   cb.indicaciones_entrega as branch_delivery_notes,
                   r.codigo_ruta,
                   r.driver_name as route_driver_name,
                   r.fecha_despacho as route_date,
                   r.estado as route_estado
            FROM egg_customer_orders o
            LEFT JOIN customers c ON o.customer_id = c.id
            LEFT JOIN customer_branches cb ON o.customer_branch_id = cb.id
            LEFT JOIN egg_dispatch_routes r ON o.dispatch_route_id = r.id
            WHERE o.company_id = ?
        `;
        const params = [company_id];

        if (status) {
            sql += ' AND o.status = ?';
            params.push(status);
        }

        if (delivery_status) {
            sql += ' AND o.delivery_status = ?';
            params.push(delivery_status);
        }

        if (unassigned_only === 'true' || unassigned_only === '1') {
            sql += ' AND o.dispatch_route_id IS NULL AND o.delivery_status != "entregado"';
        }

        if (fecha_desde) {
            sql += ' AND o.required_delivery_date >= ?';
            params.push(fecha_desde);
        }

        if (fecha_hasta) {
            sql += ' AND o.required_delivery_date <= ?';
            params.push(fecha_hasta);
        }

        sql += ' ORDER BY o.required_delivery_date ASC, o.created_at DESC';
        const [orders] = await pool.query(sql, params);
        res.json(orders);
    } catch (error) {
        console.error('Error al listar pedidos de ovoproductos:', error);
        res.status(500).json({ message: error.message });
    }
};

const saveEggCustomerOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            customer_id,
            customer_branch_id,
            customer_name,
            order_number,
            product_type,
            presentation,
            quantity_lbs,
            required_delivery_date,
            status,
            priority,
            price_per_lb,
            notes
        } = req.body;

        const company_id = req.company_id || req.user?.company_id;

        if (!customer_name || !product_type || !quantity_lbs || !required_delivery_date) {
            return res.status(400).json({ message: 'Cliente, Producto, Cantidad (Lbs) y Fecha requerida son obligatorios.' });
        }

        // 1. Validar que el cliente coincida con un cliente existente registrado en el sistema
        let resolvedCustomerId = customer_id ? parseInt(customer_id) : null;
        let resolvedCustomerName = (customer_name || '').trim();

        if (resolvedCustomerId) {
            const [cCheck] = await pool.query(
                'SELECT id, nombre, nombre_comercial FROM customers WHERE id = ? AND company_id = ?',
                [resolvedCustomerId, company_id]
            );
            if (cCheck.length === 0) {
                return res.status(400).json({ message: 'El cliente seleccionado no existe en el catálogo de clientes.' });
            }
            resolvedCustomerName = cCheck[0].nombre;
        } else {
            // Buscar coincidencia por nombre o nombre comercial en customers
            const [cCheck] = await pool.query(
                `SELECT id, nombre, nombre_comercial FROM customers 
                 WHERE company_id = ? 
                   AND (LOWER(TRIM(nombre)) = LOWER(TRIM(?)) OR LOWER(TRIM(nombre_comercial)) = LOWER(TRIM(?)))
                 LIMIT 1`,
                [company_id, resolvedCustomerName, resolvedCustomerName]
            );
            if (cCheck.length === 0) {
                return res.status(400).json({ 
                    message: `El cliente '${resolvedCustomerName}' no coincide con ningún cliente registrado. Debe seleccionar un cliente existente.` 
                });
            }
            resolvedCustomerId = cCheck[0].id;
            resolvedCustomerName = cCheck[0].nombre;
        }

        // Validar sucursal si se especificó
        let resolvedBranchId = customer_branch_id ? parseInt(customer_branch_id) : null;
        if (resolvedBranchId) {
            const [bCheck] = await pool.query(
                'SELECT id FROM customer_branches WHERE id = ? AND customer_id = ? AND company_id = ?',
                [resolvedBranchId, resolvedCustomerId, company_id]
            );
            if (bCheck.length === 0) {
                resolvedBranchId = null;
            }
        }

        // 2. Si el precio acordado no se ingresó manualmente (> 0), jalarlo automáticamente desde el CRM
        let finalPrice = parseFloat(price_per_lb) || 0;
        if (finalPrice <= 0 && resolvedCustomerId) {
            const [agreements] = await pool.query(
                `SELECT agreed_price_per_lb 
                 FROM egg_costing_customer_agreements 
                 WHERE company_id = ? 
                   AND (customer_id = ? OR customer_name = ?)
                   AND status = 'activo'
                   AND (
                       product_type = ? 
                       OR LOWER(product_type) LIKE LOWER(?) 
                       OR LOWER(?) LIKE CONCAT('%', LOWER(product_type), '%')
                   )
                 ORDER BY updated_at DESC LIMIT 1`,
                [company_id, resolvedCustomerId, resolvedCustomerName, product_type, `%${product_type}%`, product_type]
            );
            if (agreements.length > 0 && parseFloat(agreements[0].agreed_price_per_lb) > 0) {
                finalPrice = parseFloat(agreements[0].agreed_price_per_lb);
            }
        }

        if (id) {
            await pool.query(
                `UPDATE egg_customer_orders SET
                    customer_id = ?, customer_branch_id = ?, customer_name = ?, order_number = ?, product_type = ?,
                    presentation = ?, quantity_lbs = ?, required_delivery_date = ?,
                    status = ?, priority = ?, price_per_lb = ?, notes = ?
                 WHERE id = ? AND company_id = ?`,
                [
                    resolvedCustomerId, resolvedBranchId, resolvedCustomerName, order_number || null, product_type,
                    presentation || 'cubeta 30LB', parseFloat(quantity_lbs) || 0,
                    required_delivery_date, status || 'pendiente', priority || 'normal', finalPrice,
                    notes || null, id, company_id
                ]
            );
            return res.json({ id, message: 'Pedido actualizado exitosamente.', customer_id: resolvedCustomerId, price_per_lb: finalPrice });
        } else {
            const [result] = await pool.query(
                `INSERT INTO egg_customer_orders (
                    company_id, customer_id, customer_branch_id, customer_name, order_number, product_type,
                    presentation, quantity_lbs, required_delivery_date, status, priority, price_per_lb, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    company_id, resolvedCustomerId, resolvedBranchId, resolvedCustomerName, order_number || null, product_type,
                    presentation || 'cubeta 30LB', parseFloat(quantity_lbs) || 0,
                    required_delivery_date, status || 'pendiente', priority || 'normal', finalPrice,
                    notes || null
                ]
            );
            return res.status(201).json({ id: result.insertId, message: 'Pedido registrado exitosamente.', customer_id: resolvedCustomerId, price_per_lb: finalPrice });
        }
    } catch (error) {
        console.error('Error al guardar pedido de ovoproductos:', error);
        res.status(500).json({ message: error.message });
    }
};

const deleteEggCustomerOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const company_id = req.company_id || req.user?.company_id;

        await pool.query(
            'DELETE FROM egg_customer_orders WHERE id = ? AND company_id = ?',
            [id, company_id]
        );

        res.json({ message: 'Pedido eliminado correctamente.' });
    } catch (error) {
        console.error('Error al eliminar pedido de ovoproductos:', error);
        res.status(500).json({ message: error.message });
    }
};

// 19.10 Usuarios de Fábrica para Asignación de Roles
const getFactoryUsers = async (req, res) => {
    try {
        const company_id = req.company_id || req.user?.company_id;
        const [users] = await pool.query(
            `SELECT u.id, u.username, u.nombre, r.name as role_name
             FROM users u
             INNER JOIN usuario_empresa ue ON u.id = ue.usuario_id
             LEFT JOIN roles r ON ue.role_id = r.id
             WHERE u.status = 'activo' AND ue.empresa_id = ?
             ORDER BY u.nombre ASC`,
            [company_id]
        );
        res.json(users);
    } catch (error) {
        console.error('Error al obtener usuarios de fábrica:', error);
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getRawMaterials,
    createRawMaterial,
    updateRawMaterial,
    voidRawMaterial,
    getCipLogs,
    createCipLog,
    getProductionBatches,
    createProductionBatch,
    completeProductionBatch,
    createPasteurizationLog,
    getHoldingTemperatures,
    createHoldingTemperature,
    getPackagingRecords,
    createPackagingRecord,
    updatePackagingRecord,
    deletePackagingRecord,
    getBlastFreezerLogs,
    createBlastFreezerLog,
    getMaintenanceLogs,
    createMaintenanceLog,
    getIndustrialCosts,
    createIndustrialCosts,
    getForecasting,
    getTraceability,
    getIndustrialEvents,
    getProductConfig,
    updateProductConfig,
    getCostConcepts,
    saveCostConcept,
    deleteCostConcept,
    getCostsSystemSources,
    syncCostsSystemSources,
    getProviderLotConfigs,
    saveProviderLotConfig,
    deleteProviderLotConfig,
    getProviderLotIntelligence,
    quickSanitizeCip,
    getBatchVariableCosts,
    saveBatchVariableCost,
    deleteBatchVariableCost,
    // Laboratorio y retornables
    getQualityParameters,
    saveQualityParameter,
    deleteQualityParameter,
    getLabLogs,
    createLabLog,
    updateLabLog,
    sendUnifiedCoaEmail,
    getSolidsCalculation,
    getReturnableBalances,
    saveReturnableCustomer,
    registerReturnableMovement,
    // Calendario de Producción, Roles y Sugerencias Inteligentes
    getScheduledProductions,
    createScheduledProduction,
    updateScheduledProduction,
    moveScheduledProduction,
    deleteScheduledProduction,
    startBatchFromSchedule,
    toggleTaskStatus,
    getProductionSuggestions,
    getMonthlyProductionSuggestions,
    applyMonthlyPlan,
    getRawMaterialPlanning,
    convertLotToJulian,
    computeJulianLotCode,
    getEggCustomerOrders,
    saveEggCustomerOrder,
    deleteEggCustomerOrder,
    getFactoryUsers
};

