import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Music, Users, Globe } from 'lucide-react';
import Modal from '../components/Modal';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const Landing = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [joinId, setJoinId] = useState('');
  
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [isJoinOpen, setJoinOpen] = useState(false);

  const changeLanguage = (lng: string) => {
        i18n.changeLanguage(lng);
        localStorage.setItem('jamable_language', lng);
    };

  const handleCreate = async () => {
    if (!nickname) return alert(t('nickname') + ' required');
    try {
      const res = await axios.post(`${API_URL}/api/create_room`, null, {
        params: { password: password || undefined, nickname }
      });
      navigate(`/room/${res.data.room_id}`, { state: { nickname, password } });
    } catch (e) {
      console.error(e);
      alert('Error creating room');
    }
  };

  const handleJoin = () => {
    if (!joinId || !nickname) return alert('ID & Nickname required');
    navigate(`/room/${joinId}`, { state: { nickname } });
  };

  return (
    <div className="flex flex-col min-h-screen bg-slate-950 text-white font-sans selection:bg-blue-500 selection:text-white">
      {/* Navbar */}
      <nav className="flex items-center justify-between px-6 py-4 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 sticky top-0 z-40">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Music className="text-white w-5 h-5" />
          </div>
          <span className="text-xl font-bold tracking-tight">Jamable</span>
        </div>
        
        <div className="flex items-center gap-2 bg-slate-800 rounded-full px-3 py-1.5 border border-slate-700">
          <Globe className="w-4 h-4 text-gray-400" />
          <select 
            className="bg-transparent text-sm text-gray-200 outline-none cursor-pointer"
            onChange={(e) => changeLanguage(e.target.value)}
            value={i18n.language}
          >
            <option value="en" className="bg-slate-800">EN</option>
            <option value="ru" className="bg-slate-800">RU</option>
            <option value="de" className="bg-slate-800">DE</option>
          </select>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-4xl mx-auto w-full animate-fade-in-up">
        <div className="space-y-6 mb-12">
          <h1 className="text-5xl md:text-7xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-300 pb-2">
            Jammable
          </h1>
          <p className="text-xl md:text-2xl text-slate-400 max-w-2xl mx-auto leading-relaxed">
            {t('description')}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-6 w-full max-w-md">
          <button 
            onClick={() => setCreateOpen(true)}
            className="flex-1 group relative p-4 bg-blue-600 hover:bg-blue-500 rounded-xl transition-all duration-300 shadow-lg shadow-blue-900/20 hover:shadow-blue-600/30 hover:-translate-y-1"
          >
            <div className="flex flex-col items-center gap-2">
              <Music className="w-8 h-8 mb-1" />
              <span className="font-bold text-lg">{t('create_room')}</span>
            </div>
          </button>

          <button 
            onClick={() => setJoinOpen(true)}
            className="flex-1 group relative p-4 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 rounded-xl transition-all duration-300 shadow-lg hover:-translate-y-1"
          >
             <div className="flex flex-col items-center gap-2">
              <Users className="w-8 h-8 mb-1 text-blue-400" />
              <span className="font-bold text-lg">{t('join_room')}</span>
            </div>
          </button>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-6 text-center text-slate-600 text-sm">
        <p>© 2026 Jammable. Open Source Music Sync.</p>
      </footer>

      {/* Create Room Modal */}
      <Modal isOpen={isCreateOpen} onClose={() => setCreateOpen(false)} title={t('create_room')}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">{t('nickname')}</label>
            <input
              type="text"
              className="w-full p-3 rounded-lg bg-slate-900 border border-slate-700 focus:border-blue-500 outline-none transition text-white"
              value={nickname}
              onChange={e => setNickname(e.target.value)}
              placeholder="Admin"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">{t('password')}</label>
            <input
              type="password"
              className="w-full p-3 rounded-lg bg-slate-900 border border-slate-700 focus:border-blue-500 outline-none transition text-white"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <button 
            onClick={handleCreate}
            className="w-full py-3 mt-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-bold shadow-lg shadow-blue-600/20 transition-all"
          >
            {t('create_room')}
          </button>
        </div>
      </Modal>

      {/* Join Room Modal */}
      <Modal isOpen={isJoinOpen} onClose={() => setJoinOpen(false)} title={t('join_room')}>
        <div className="space-y-4">
          <div>
             <label className="block text-sm font-medium text-slate-400 mb-1">{t('room_id')}</label>
            <input
              type="text"
              className="w-full p-3 rounded-lg bg-slate-900 border border-slate-700 focus:border-blue-500 outline-none transition text-white"
              value={joinId}
              onChange={e => setJoinId(e.target.value)}
              placeholder="e.g. a1b2c3d4"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">{t('nickname')}</label>
            <input
              type="text"
              className="w-full p-3 rounded-lg bg-slate-900 border border-slate-700 focus:border-blue-500 outline-none transition text-white"
              value={nickname}
              onChange={e => setNickname(e.target.value)}
              placeholder="Guest"
            />
          </div>
          <button 
            onClick={handleJoin}
            className="w-full py-3 mt-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-bold shadow-lg shadow-blue-600/20 transition-all"
          >
            {t('join_room')}
          </button>
        </div>
      </Modal>
    </div>
  );
};

export default Landing;