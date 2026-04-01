import React, { useState, useEffect } from 'react';
import { DebuggerPage } from './pages/Debugger';
import { AnalyzerPage } from './pages/Analyzer';
import { OptimizerPage } from './pages/Optimizer';

// 标签页类型
type TabId = 'debugger' | 'analyzer' | 'optimizer';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('debugger');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // 初始化应用
    const initApp = async () => {
      try {
        // 检查Electron API是否可用
        if (window.electronAPI) {
          console.log('Electron API available');
          // 加载设置
          const settings = await window.electronAPI.settings.get();
          console.log('Settings loaded:', settings);
        }
      } catch (error) {
        console.error('Failed to initialize app:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initApp();
  }, []);

  // 渲染当前标签页内容
  const renderContent = () => {
    switch (activeTab) {
      case 'debugger':
        return <DebuggerPage />;
      case 'analyzer':
        return <AnalyzerPage />;
      case 'optimizer':
        return <OptimizerPage />;
      default:
        return <DebuggerPage />;
    }
  };

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Loading RdcAgent...</p>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* 标签栏 */}
      <header className="app-header">
        <div className="app-title">
          <span className="logo">RdcAgent</span>
          <span className="subtitle">RenderDoc Debug Agent</span>
        </div>
        <nav className="tab-nav">
          <button
            className={`tab-button ${activeTab === 'debugger' ? 'active' : ''}`}
            onClick={() => setActiveTab('debugger')}
          >
            Debugger
          </button>
          <button
            className={`tab-button ${activeTab === 'analyzer' ? 'active' : ''}`}
            onClick={() => setActiveTab('analyzer')}
            disabled
            title="Coming Soon"
          >
            Analyzer
          </button>
          <button
            className={`tab-button ${activeTab === 'optimizer' ? 'active' : ''}`}
            onClick={() => setActiveTab('optimizer')}
            disabled
            title="Coming Soon"
          >
            Optimizer
          </button>
        </nav>
      </header>

      {/* 主内容区 */}
      <main className="app-content">
        {renderContent()}
      </main>

      {/* 状态栏 */}
      <footer className="app-footer">
        <div className="status-left">
          <span className="status-item">Context: --</span>
          <span className="status-item">Session: --</span>
        </div>
        <div className="status-right">
          <span className="status-item">LLM: --</span>
          <span className="status-item">v1.0.0</span>
        </div>
      </footer>
    </div>
  );
};

export default App;
