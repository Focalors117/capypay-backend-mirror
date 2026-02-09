const supabase = require('../config/supabase');

// GET /api/comedor/menu
const getMenu = async (req, res) => {
    try {
        const { category } = req.query;
        let query = supabase.from('menu_items').select('*').eq('is_available', true);

        if (category) {
            query = query.eq('category', category);
        }

        const { data, error } = await query;

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        // Logic to separate "Plato del Dia", "Popular" and "Carousel"
        // Strategy: 
        // 1. Plato del Dia: First item with 'is_featured'
        // 2. Popular: Top 3-5 items by sales_count (if available)
        // 3. Carousel: Rest of the items
        
        let platoDia = null;
        let popularItems = [];
        let carouselItems = [];

        if (data && data.length > 0) {
            // 1. Plato del Dia (PRIORIDAD: Comida Gratuita / Precio 0 / 'Bandeja')
            // Buscamos un item con precio 0.
            const freeItem = data.find(i => parseFloat(i.price) === 0 || i.price === 0);
            
            // Si existe gratis, ese es el plato del día. Si no, el featured o el primero.
            const featured = freeItem || data.find(i => i.is_featured) || data[0];

            platoDia = {
                id: featured.id,
                name: featured.name,
                description: featured.description,
                price: featured.price,
                image_url: featured.image_url,
                is_featured: true,
                sales_count: featured.sales_count || 0
            };
            
            // 2. Popular Items
            popularItems = [...data]
                .sort((a, b) => (b.sales_count || 0) - (a.sales_count || 0))
                .slice(0, 5); // Top 5
            
            // 3. Carousel (All items, or exclude Plato del Dia)
            carouselItems = data.filter(i => i.id !== platoDia.id);
            
            if (carouselItems.length === 0) {
                carouselItems.push(platoDia);
            }
        } else {
            // Caso DB vacía (sin items)
            platoDia = null;
            popularItems = [];
            carouselItems = [];
        }

        res.json({
            platoDia: platoDia,
            popularItems: popularItems,
            items: carouselItems
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

// GET /api/comedor/stats
const getStats = async (req, res) => {
    try {
        // 1. Get Count of Preparing Orders
        const { count, error } = await supabase
            .from('orders')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'preparing'); 

        if (error) throw error;

        // 2. Real Wait Time Calculation (Moving Average)
        // Fetch last 50 completed orders to calculate average prep time
        const { data: pastOrders } = await supabase
            .from('orders')
            .select('created_at, completed_at')
            .eq('status', 'completed')
            .not('completed_at', 'is', null)
            .order('completed_at', { ascending: false })
            .limit(50);
        
        let avgMinutes = 5; 
        if (pastOrders && pastOrders.length > 5) {
            const totalMinutes = pastOrders.reduce((acc, order) => {
                const start = new Date(order.created_at);
                const end = new Date(order.completed_at);
                // Sanity Check: If diff is insane (e.g. > 2 hours/120min) ignore it (maybe left overnight)
                // Also ignore negative times
                const diff = (end - start) / 60000;
                if(diff > 0 && diff < 60) return acc + diff;
                return acc + 5; // fallback weight
            }, 0);
            avgMinutes = Math.ceil(totalMinutes / pastOrders.length);
        }
        
        // Safety Clamp: Don't scare users with 3000 min
        avgMinutes = Math.max(2, Math.min(avgMinutes, 15)); // Min 2 min, Max 15 min per plate avg

        const activeOrders = count || 0;
        const totalWaitMins = activeOrders * avgMinutes;
        
        // Cap total wait time display to 60 mins to seem manageable (UI logic handles "Very High")
        const displayWaitMin = Math.min(totalWaitMins, 120); 

        // Determine Level string based on Wait Time, not just count
        let nivel = 'Normal';
        const occupancyRate = Math.min(100, (activeOrders / 30) * 100); // 30 capacity base
        
        if (occupancyRate > 75) nivel = 'Full';
        else if (occupancyRate > 50) nivel = 'Alta';
        else if (occupancyRate > 25) nivel = 'Media';
        else nivel = 'Baja';

        // 3. Get Oldest Order (Next to be served)
        const { data: nextOrders } = await supabase
            .from('orders')
            .select('id')
            .eq('status', 'preparing')
            .order('created_at', { ascending: true })
            .limit(1);

        // Format Next Ticket
        let proximoTurno = 'Sin cola';
        if (nextOrders && nextOrders.length > 0) {
            const id = String(nextOrders[0].id);
            proximoTurno = id.length > 10 ? `Ticket #${id.slice(0,4)}` : `Ticket #${id}`;
        }

        // 4. Calculate Position (If orderId provided)
        let turnsAhead = null;
        if (req.query.orderId) {
            const { data: targetOrder } = await supabase
                .from('orders')
                .select('created_at')
                .eq('id', req.query.orderId)
                .single();

            if (targetOrder) {
                const { count: aheadCount } = await supabase
                    .from('orders')
                    .select('*', { count: 'exact', head: true })
                    .eq('status', 'preparing')
                    .lt('created_at', targetOrder.created_at);
                
                turnsAhead = aheadCount;
            }
        }
        
        // Smart Message Logic
        let detalleMsg = "Sin cola, excelente momento";
        if (activeOrders > 0) detalleMsg = "Flujo constante";
        if (activeOrders > 10) detalleMsg = "Tráfico alto en cocina";
        if (activeOrders > 25) detalleMsg = "Comedor a máxima capacidad";

        res.json({
            ocupacion: {
                nivel: nivel,
                porcentaje: occupancyRate, // Improved calc
                detalle: detalleMsg,
                count: activeOrders 
            },
            tiempoEspera: totalWaitMins > 0 ? `${displayWaitMin}-${displayWaitMin + 5} min` : '5-10 min',
            proximoTurno: proximoTurno,
            turnsAhead: turnsAhead // Return the calculated position
        });
    } catch (err) {
        console.error(err);
        // Fallback response so frontend doesn't break
        res.json({
            ocupacion: { nivel: 'Desconocido', porcentaje: 0, detalle: 'Error de conexión' },
            tiempoEspera: '-- min',
            proximoTurno: '---'
        });
    }
};

// POST /api/comedor/order
const createOrder = async (req, res) => {
    const { user_id, items } = req.body; // items: [{ id, quantity }]

    if (!user_id || !items || items.length === 0) {
        return res.status(400).json({ error: "Missing user_id or items" });
    }

    try {
        // 1. Calculate Total & Prepare atomic data
        let total = 0;
        let isFeatured = false;
        const atomicItems = [];

        // Fetch prices (to avoid client trust)
        const itemIds = items.map(i => i.id);
        const { data: menuItems, error: menuErr } = await supabase
            .from('menu_items')
            .select('*')
            .in('id', itemIds);
        
        if (menuErr || !menuItems) return res.status(500).json({ error: "Error fetching menu" });

        for (const itemRequest of items) {
            const product = menuItems.find(p => String(p.id) === String(itemRequest.id));
            if (!product) return res.status(400).json({ error: `Item ${itemRequest.id} not found` });
            
            // Note: Availability check is done inside the Atomic function now (Double check)
            if (product.stock < itemRequest.quantity) return res.status(400).json({ error: `Not enough stock for ${product.name}` });
            
            if (product.is_featured) isFeatured = true;

            const itemTotal = parseFloat(product.price) * itemRequest.quantity;
            total += itemTotal;

            atomicItems.push({
                id: product.id,
                quantity: itemRequest.quantity,
                price: product.price,
                name: product.name 
            });
        }

        // 1.5 Calculate Commission (5% Service Fee)
        // Matches frontend logic to ensure consistency
        const commission = Math.round(total * 0.05);
        total += commission;

        // 2. Calculate XP vs Ranking Points
        
        // XP (Profile Level) -> 10% of total
        const xpGained = Math.ceil(total * 0.1); 

        // Ranking Points (Competition) -> Base + Frequency + Volume + Bonus
        let pointsGained = 20; // Base for Frequency
        pointsGained += Math.ceil(total * 0.05); // Volume (5%)
        
        if (isFeatured) {
            pointsGained *= 2; // X2 Multiplier for Featured Dish
        }

        pointsGained = Math.floor(pointsGained);

        // 3. ATOMIC TRANSACTION (RPC)
        const { data: result, error: rpcError } = await supabase
            .rpc('create_order_atomic', {
                p_user_id: user_id,
                p_items: atomicItems,
                p_total: total,
                p_xp_gained: xpGained,
                p_points_gained: pointsGained
            });

        if (rpcError) throw rpcError;

        // result is [{ order_id: "...", success: true }]
        const orderId = result && result[0] ? result[0].order_id : null;

        res.status(201).json({ 
            message: "Pedido realizado con éxito", 
            orderId: orderId, 
            xpGained,
            pointsGained,
            stats: { 
                level_xp: xpGained,
                ranking_points: pointsGained
            }
        });

    } catch (err) {
        console.error("Order Error:", err);
        // Better error message handling
        const msg = err.message || "Transaction Failed";
        res.status(400).json({ error: msg });
    }
};

// GET /api/comedor/order/:id
const getOrder = async (req, res) => {
    const { id } = req.params;
    try {
        const { data: order, error } = await supabase
            .from('orders')
            .select(`
                *,
                order_items (
                    quantity,
                    price_at_time,
                    menu_items ( name, image_url )
                )
            `)
            .eq('id', id)
            .single();

        if (error || !order) return res.status(404).json({ error: "Order not found" });

        res.json({ order });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal Error" });
    }
};

// GET /api/comedor/my-orders/:userId
const getUserOrders = async (req, res) => {
    const { userId } = req.params;
    try {
        const { data: orders, error } = await supabase
            .from('orders')
            .select(`
                *,
                order_items (
                    quantity,
                    menu_items ( name )
                )
            `)
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ orders });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal Error" });
    }
}

// DEV ONLY: Complete all active orders (Simular Cocina)
const completeAllOrders = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('orders')
            .update({ 
                status: 'completed', 
                completed_at: new Date().toISOString() 
            })
            .eq('status', 'preparing')
            .select();

        if (error) throw error;

        res.json({ 
            message: "✅ ¡Cocina limpiada! Todas las órdenes están listas.", 
            count: data.length,
            ids: data.map(o => o.id)
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

module.exports = {
    getMenu,
    getStats,
    createOrder,
    getOrder,
    getUserOrders,
    completeAllOrders
};
