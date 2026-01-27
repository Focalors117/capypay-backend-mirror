const supabase = require('../config/supabase');

const getNotifications = async (req, res) => {
    const { userId } = req.params;

    if (!userId) {
        return res.status(400).json({ error: "Missing userId" });
    }

    try {
        const { data, error } = await supabase
            .from('notifications')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(20);

        if (error) {
            console.error(error);
            return res.status(500).json({ error: error.message });
        }

        return res.status(200).json({ notifications: data });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};

const markAsRead = async (req, res) => {
    const { id } = req.params;

    try {
        const { data, error } = await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('id', id)
            .select();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        return res.status(200).json({ message: "Marked as read", notification: data });

    } catch (e) {
        return res.status(500).json({ error: "Internal Server Error" });
    }
};

module.exports = {
    getNotifications,
    markAsRead
};
