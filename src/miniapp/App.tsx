// Здесь ИСКЛЮЧИТЕЛЬНО назначаем ссылки для страниц в мини-приложении
import { useMiniApp } from './context/MiniAppContext';
import Shell from './pages/Shell';
import Authorization from './pages/Authorization';
import Home from './pages/Home';
import CreateSubscription from './pages/CreateSubscription';
import Replenish from './pages/Replenish';
import Payment from './pages/Payment';
import Subscriptions from './pages/Subscriptions';
import Instruction from './pages/Instruction';
import History from './pages/History';
import Refferals from './pages/Refferals';
import Promocode from './pages/Promocode';

export default function App() {
  const { view, topupStep, needsChannelSubscription, isBanned } = useMiniApp() as {
    view: string;
    topupStep: number;
    needsChannelSubscription: boolean;
    isBanned: boolean;
  };

  if (needsChannelSubscription || isBanned) {
    return <Authorization />;
  }

  return (
    <Shell>
        {view === 'home' && <Home />}
        {view === 'wizard' && <CreateSubscription />}
        {view === 'topup' && topupStep === 1 && <Replenish />}
        {view === 'topup' && topupStep === 2 && <Payment />}
        {view === 'wait_payment' && <Payment />}
        {view === 'success_payment' && <Payment />}
        {(view === 'devices' || view === 'extend_subscription' || view === 'buy_device') && <Subscriptions />}
        {view === 'instruction_view' && <Instruction key="instruction" />}
        {view === 'history' && <History />}
        {(view === 'referral' || view === 'referral_detail') && <Refferals />}
        {view === 'promo' && <Promocode />}
    </Shell>
  );
}
