import React from 'react';
import { ChevronLeft, X } from 'lucide-react';

// ==========================================
// 3. UI COMPONENTS
// ==========================================

const AnimatedBackground: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="max-w-md mx-auto min-h-screen w-full relative text-zinc-200 font-sans selection:bg-orange-500/30 tg-safe-padding overflow-x-clip" style={{ background: '#000', isolation: 'isolate', paddingTop: '56px' }}>
    <style>{`
      @keyframes drift1 {
        0%   { transform: translate(0px, 0px); }
        25%  { transform: translate(30px, 50px); }
        50%  { transform: translate(-20px, 90px); }
        75%  { transform: translate(40px, 40px); }
        100% { transform: translate(0px, 0px); }
      }
      @keyframes drift2 {
        0%   { transform: translate(0px, 0px); }
        30%  { transform: translate(-40px, -60px); }
        60%  { transform: translate(20px, -100px); }
        100% { transform: translate(0px, 0px); }
      }
      .mb-orb {
        position: absolute;
        border-radius: 50%;
        pointer-events: none;
        z-index: 0;
      }
      .mb-orb-1 {
        width: 380px; height: 380px;
        top: -120px; left: -100px;
        background: radial-gradient(circle at 50% 50%,
          rgba(234,88,12,0.13) 0%,
          rgba(194,65,12,0.06) 45%,
          transparent 70%);
        filter: blur(40px);
        animation: drift1 35s ease-in-out infinite;
      }
      .mb-orb-2 {
        width: 420px; height: 420px;
        bottom: -80px; right: -140px;
        background: radial-gradient(circle at 50% 50%,
          rgba(249,115,22,0.10) 0%,
          rgba(234,88,12,0.04) 45%,
          transparent 70%);
        filter: blur(50px);
        animation: drift2 45s ease-in-out infinite;
      }
      .user-load-failed button,
      .user-load-failed a[class*="rounded"] {
        background: #3f3f46 !important;
        background-image: none !important;
        color: #71717a !important;
        box-shadow: none !important;
        border-color: #52525b !important;
        cursor: not-allowed !important;
        opacity: 0.6 !important;
      }
    `}</style>
    <div className="mb-orb mb-orb-1" />
    <div className="mb-orb mb-orb-2" />
    <div style={{ position: 'relative', zIndex: 1 }}>
      {children}
    </div>
  </div>
);

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost' | 'trial' | 'gold';
}

const Button: React.FC<ButtonProps> = ({ children, onClick, variant = 'primary', className = '', disabled = false }) => {
  const baseStyle = "w-full py-3.5 rounded-xl font-semibold transition-all duration-200 flex items-center justify-center gap-2 active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100 disabled:cursor-not-allowed ripple";
  const variants = {
    primary: "bg-orange-600 hover:bg-orange-500 text-white shadow-lg shadow-black/60",
    secondary: "bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800",
    outline: "border-2 border-orange-500/40 text-orange-400 hover:bg-orange-500/10",
    danger: "bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20",
    ghost: "text-zinc-400 hover:text-white hover:bg-zinc-900/80",
    trial: "bg-gradient-to-r from-purple-600 to-orange-500 text-white shadow-lg shadow-purple-900/40 hover:brightness-110",
    gold: "bg-gradient-to-r from-amber-500 to-yellow-600 text-white shadow-lg shadow-amber-900/40"
  };

  return (
    <button type="button" onClick={onClick} className={`${baseStyle} ${variants[variant]} ripple ${className}`} disabled={disabled}>
      {children}
    </button>
  );
};

const Card: React.FC<{ children: React.ReactNode, className?: string, onClick?: () => void }> = ({ children, className = '', onClick }) => (
  <div onClick={onClick} className={`bg-zinc-900 backdrop-blur-md border border-zinc-700/80 rounded-2xl p-5 card-hover ${className}`}>
    {children}
  </div>
);

const Header: React.FC<{ title: string, onBack?: () => void }> = ({ title, onBack }) => (
  <div className="flex items-center gap-3 mb-6">
    {onBack && (
      <button onClick={onBack} className="w-10 h-10 rounded-full bg-zinc-900 flex items-center justify-center text-zinc-300 hover:text-white transition-colors">
        <ChevronLeft size={22} />
      </button>
    )}
    <h1 className="text-2xl font-bold text-white">{title}</h1>
  </div>
);

const Modal: React.FC<{ title: string, isOpen: boolean, onClose: () => void, children: React.ReactNode, fullHeight?: boolean }> = ({ title, isOpen, onClose, children, fullHeight = false }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity" onClick={onClose}></div>
      <div className={`relative bg-black border border-zinc-900 w-full max-w-sm rounded-2xl p-6 shadow-2xl shadow-orange-950/20 transform transition-all scale-100 flex flex-col ${fullHeight ? 'h-[85vh]' : 'max-h-[90vh]'}`}>
        <div className="flex justify-between items-center mb-4 shrink-0">
          <h3 className="text-xl font-bold text-white">{title}</h3>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white">
            <X size={20} />
          </button>
        </div>
        <div className="overflow-y-auto custom-scrollbar flex-1 pr-1">
            {children}
        </div>
      </div>
    </div>
  );
};

// Simple Markdown Renderer for Legal Docs
const MarkdownRenderer: React.FC<{ content: string }> = ({ content }) => {
  const lines = content.split('\n');
  return (
    <div className="space-y-3 text-zinc-300 text-sm leading-relaxed">
      {lines.map((line, idx) => {
        if (line.startsWith('### ')) {
          return <h3 key={idx} className="text-lg font-bold text-white mt-4 mb-2">{line.replace('### ', '')}</h3>;
        }
        if (line.startsWith('**') && !line.includes('**', 2)) {
          // Headers that are just bold lines or similar
          return <p key={idx} className="font-bold text-white">{line.replace(/\*\*/g, '')}</p>;
        }
        if (line.startsWith('* ')) {
           // List items
           const cleanLine = line.replace('* ', '');
           // Simple bold parser for inside line
           const parts = cleanLine.split('**');
           return (
             <div key={idx} className="flex gap-2 pl-2">
                <span className="text-orange-500 mt-1.5">•</span>
                <span>
                    {parts.map((part, pIdx) => (pIdx % 2 === 1 ? <strong key={pIdx} className="text-zinc-200">{part}</strong> : part))}
                </span>
             </div>
           );
        }
        // Paragraphs with inline bold
        const parts = line.split('**');
        return (
            <p key={idx} className={line.trim() === '' ? 'h-2' : ''}>
                {parts.map((part, pIdx) => (pIdx % 2 === 1 ? <strong key={pIdx} className="text-zinc-200">{part}</strong> : part))}
            </p>
        );
      })}
    </div>
  );
};

export { AnimatedBackground, Button, Card, Header, Modal, MarkdownRenderer };
