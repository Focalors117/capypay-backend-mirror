const supabase = require('../config/supabase');

// HELPER: Faculty Meta
const FACULTY_META = {
    'Ingeniería': { color: '#3b82f6', icon: '🔧' },
    'Medicina': { color: '#ef4444', icon: '⚕️' },
    'Ciencias Económicas': { color: '#10b981', icon: '💰' },
    'Odontología': { color: '#f59e0b', icon: '🦷' },
    'Derecho': { color: '#8b5cf6', icon: '⚖️' },
    'Agronomía': { color: '#84cc16', icon: '🌾' }
};

// GET /api/ranking
const getRanking = async (req, res) => {
    try {
        const { user_id } = req.query; 

        // 1. Fetch Top 50 Users (Ordered by RANKING POINTS, not XP)
        const { data: allUsers, error } = await supabase
            .from('profiles')
            .select('id, name, ranking_points, xp, faculty, career') 
            .order('ranking_points', { ascending: false })
            .limit(50);

        if (error) throw error;

        // Formato para Usuarios
        const formattedList = allUsers.map((u, index) => ({
            rank: index + 1,
            name: u.name,
            points: u.ranking_points || 0, // Using Competition Points now
            level_xp: u.xp, // We can send this too if needed context
            avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(u.name)}&background=random&color=fff`,
            faculty: u.faculty || 'General',
            career: u.career || 'Estudiante',
            id: u.id
        }));

        // Datos del Usuario Actual
        let userData = { name: 'Invitado', rank: '-', points: 0, avatar: '' };
        let rivalData = { rank: '-', avatar: '' };

        if (user_id) {
            // Buscamos en la lista descargada
            const found = formattedList.find(u => u.id === user_id);
            if (found) {
                userData = found;
                if (found.rank > 1) {
                    rivalData = formattedList[found.rank - 2];
                }
            } else {
                 // Fetch isolated if not in top 50
                 const { data: singleUser } = await supabase.from('profiles').select('name, ranking_points, faculty').eq('id', user_id).single();
                 if (singleUser) {
                      userData = { 
                          rank: '>50', 
                          name: singleUser.name, 
                          points: singleUser.ranking_points || 0,
                          avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(singleUser.name)}&background=random&color=fff`
                      };
                 }
            }
        }

        // 2. Faculty Battle Logic (Aggregation by Competition Points)
        const { data: allProfiles } = await supabase.from('profiles').select('faculty, ranking_points');
        
        const facultyStats = {};
        allProfiles?.forEach(p => {
             const f = p.faculty || 'Sin Facultad';
             if (!facultyStats[f]) facultyStats[f] = { name: f, xp: 0, members: 0 };
             facultyStats[f].xp += (p.ranking_points || 0); // Aggregate Tournament Points
             facultyStats[f].members++;
        });

        const battleList = Object.values(facultyStats)
            .sort((a, b) => b.xp - a.xp)
            .map((f, i) => ({
                rank: i + 1,
                ...f,
                meta: FACULTY_META[f.name] || { color: '#6b7280', icon: '🏛️' }
            }));


        res.json({
            users: {
                top3: formattedList.slice(0, 3),
                list: formattedList.slice(3, 20), // Top 4-20
                user: userData,
                rival: rivalData
            },
            faculties: battleList
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error fetching ranking" });
    }
};

module.exports = {
    getRanking
};
