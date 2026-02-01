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

        // Logic to separate "Plato del Dia" vs Normal Items
        // Strategy: First item with 'is_featured' is Plato del Dia, rest are carousel items
        // If no 'is_featured', just take the first one.
        
        // Mocking transformation if database structure is simple
        let platoDia = null;
        let carouselItems = [];

        if (data && data.length > 0) {
            const featured = data.find(i => i.is_featured) || data[0];
            platoDia = {
                id: featured.id,
                name: featured.name,
                description: featured.description,
                price: featured.price,
                image_url: featured.image_url,
                is_featured: true
            };
            
            // Carousel uses the rest, or all (minus the featured one if you prefer unique)
            carouselItems = data.filter(i => i.id !== platoDia.id).map(i => ({
                id: i.id,
                name: i.name,
                description: i.description,
                price: i.price,
                image_url: i.image_url
            }));
            
            // If only 1 item exists, put it in carousel too so it's not empty?
            if (carouselItems.length === 0) {
                carouselItems.push(platoDia);
            }
        }

        res.json({
            platoDia: platoDia,
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
        // We use 'head: true' and 'count: exact' to just count rows without fetching data
        const { count, error } = await supabase
            .from('orders')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'preparing'); 

        const activeOrders = count || 0;
        const occupancyPercent = Math.min(100, activeOrders * 5); // 5% per active order
        const waitMins = activeOrders * 3; // 3 mins per order

        // Determine Level string
        let nivel = 'Baja';
        if (occupancyPercent > 80) nivel = 'Alta';
        else if (occupancyPercent > 40) nivel = 'Media';

        res.json({
            ocupacion: {
                nivel: nivel,
                porcentaje: occupancyPercent,
                detalle: `${activeOrders} pedidos en cola`
            },
            tiempoEspera: waitMins > 0 ? `${waitMins} min` : 'Sin espera',
            proximoTurno: 'Ticket #--' // Could be dynamic if we implemented ticketing
        });
    } catch (err) {
        console.error(err);
        // Fallback response so frontend doesn't break
        res.json({
            ocupacion: { nivel: 'Baja', porcentaje: 5, detalle: 'Sistema Offline' },
            tiempoEspera: '5 min',
            proximoTurno: 'A-001'
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
        // 1. Calculate Total & Check Stock
        let total = 0;
        const orderItemsData = [];

        // Fetch prices (to avoid client trust)
        const itemIds = items.map(i => i.id);
        const { data: menuItems, error: menuErr } = await supabase
            .from('menu_items')
            .select('*')
            .in('id', itemIds);
        
        if (menuErr || !menuItems) return res.status(500).json({ error: "Error fetching menu" });

        for (const itemRequest of items) {
            // Use loose equality or string conversion for ID matching (Postgres returns numbers, JSON sends strings)
            const product = menuItems.find(p => String(p.id) === String(itemRequest.id));
            
            if (!product) return res.status(400).json({ error: `Item ${itemRequest.id} not found` });
            if (product.stock < itemRequest.quantity) return res.status(400).json({ error: `Not enough stock for ${product.name}` });

            total += parseFloat(product.price) * itemRequest.quantity;
            orderItemsData.push({
                menu_item_id: product.id,
                quantity: itemRequest.quantity,
                price_at_time: product.price
            });
        }

        // 2. Check User Balance
        const { data: user, error: userErr } = await supabase
            .from('profiles')
            .select('balance, xp')
            .eq('id', user_id)
            .single();

        if (userErr || !user) return res.status(404).json({ error: "User not found" });

        if (user.balance < total) {
            return res.status(400).json({ error: "Saldo insuficiente" });
        }

        // 3. Deduct Balance
        const newBalance = user.balance - total;
        // 4. Add XP (10% of total spent?)
        const xpGained = Math.floor(total * 0.1);
        const newXP = (user.xp || 0) + xpGained;

        const { error: updateErr } = await supabase
            .from('profiles')
            .update({ balance: newBalance, xp: newXP })
            .eq('id', user_id);

        if (updateErr) throw updateErr;

        // 5. Create Order
        const { data: order, error: orderErr } = await supabase
            .from('orders')
            .insert([{ user_id, total, status: 'preparing' }])
            .select()
            .single();

        if (orderErr) throw orderErr;

        // 6. Create Order Items
        const itemsToInsert = orderItemsData.map(i => ({ ...i, order_id: order.id }));
        const { error: itemsErr } = await supabase.from('order_items').insert(itemsToInsert);

        if (itemsErr) throw itemsErr;

        // 7. Update Stock (Simple loop)
        for (const i of items) {
             // In real app, use RPC for atomic decrement
             const product = menuItems.find(p => String(p.id) === String(i.id));
             if (product) {
                 await supabase.from('menu_items').update({ stock: product.stock - i.quantity }).eq('id', i.id);
             }
        }

        res.status(201).json({ 
            message: "Pedido realizado con éxito", 
            orderId: order.id, 
            newBalance,
            xpGained 
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Transaction Failed" });
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

module.exports = {
    getMenu,
    getStats,
    createOrder,
    getOrder,
    getUserOrders
};
