// Здесь ИСКЛЮЧИТЕЛЬНО назначаем ссылки для страниц в панели
import { useState, useEffect } from 'react';
import { Loader } from 'lucide-react';
import { getPanelToken, clearPanelToken } from '../api/client';
import { PanelProvider, usePanel } from './context/PanelContext';
import Authorization from './pages/Authorization';
import Shell from './pages/Shell';
import Home from './pages/Home';
import Finance from './pages/Finance';
import Statistics from './pages/Statistics';
import Users from './pages/Users';
import Subscriptions from './pages/Subscriptions';
import Newsletter from './pages/Newsletter';
import Promocodes from './pages/Promocodes';
import Settings from './pages/Settings';

function PanelRoutes() {
  const { activePage } = usePanel() as { activePage: string };

  return (
    <Shell>
      {activePage === 'Главная страница' && <Home />}
      {activePage === 'Финансы' && <Finance />}
      {activePage === 'Статистика' && <Statistics />}
      {activePage === 'Пользователи' && <Users />}
      {activePage === 'Подписки' && <Subscriptions />}
      {activePage === 'Рассылка' && <Newsletter />}
      {activePage === 'Промокоды' && <Promocodes />}
      {activePage === 'Настройки' && <Settings />}
    </Shell>
  );
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    const token = getPanelToken();
    if (!token) {
      setIsAuthenticated(false);
      return;
    }

    fetch('/api/panel/stats/summary', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })
      .then((res) => {
        if (res.ok) {
          setIsAuthenticated(true);
        } else {
          clearPanelToken();
          setIsAuthenticated(false);
        }
      })
      .catch(() => {
        setIsAuthenticated(false);
      });
  }, []);

  const handleLogin = (_token: string) => {
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    clearPanelToken();
    setIsAuthenticated(false);
  };

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader size={40} className="animate-spin text-orange-500" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Authorization onLogin={handleLogin} />;
  }

  return (
    <PanelProvider onLogout={handleLogout}>
      <PanelRoutes />
    </PanelProvider>
  );
}
