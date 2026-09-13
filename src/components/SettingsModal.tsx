import { useEffect, useState } from 'react';
import { FolderOpen, KeyRound } from 'lucide-react';
import Modal from './Modal';
import { useEditor } from '../store/editor';

export default function SettingsModal({ onClose }: { onClose(): void }) {
  const projectSettings = useEditor((state) => state.project.settings);
  const updateSettings = useEditor((state) => state.updateSettings);
  const [apiKey, setApiKey] = useState('');
  const [reasoning, setReasoning] = useState<'medium' | 'high'>('medium');
  const [blenderPath, setBlenderPath] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => { window.abaco?.getSettings().then((settings) => { setHasKey(settings.hasApiKey); setReasoning(settings.reasoning); setBlenderPath(settings.blenderPath); }); }, []);
  const browse = async () => { const path = await window.abaco?.chooseBlender(); if (path) setBlenderPath(path); };
  const save = async () => {
    if (!window.abaco) return setStatus('Apri questa schermata nell’app desktop Electron.');
    await window.abaco.saveSettings({ apiKey: apiKey || undefined, reasoning, blenderPath: blenderPath || undefined });
    setStatus('Impostazioni salvate.'); setHasKey(Boolean(apiKey) || hasKey); setApiKey('');
  };
  return <Modal title="Impostazioni" onClose={onClose}>
    <div className="settings-form">
      <label className="field"><span>Chiave API OpenAI</span><div className="input-with-icon"><KeyRound size={16} /><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={hasKey ? 'Chiave configurata · inserisci per sostituire' : 'sk-…'} /></div><small>Viene cifrata dal sistema e non entra mai nel progetto.</small></label>
      <label className="field"><span>Ragionamento Astra</span><select value={reasoning} onChange={(event) => setReasoning(event.target.value as 'medium' | 'high')}><option value="medium">Medium · consigliato</option><option value="high">High · scene più complesse</option></select></label>
      <label className="field"><span>Eseguibile Blender</span><div className="path-picker"><input value={blenderPath} onChange={(event) => setBlenderPath(event.target.value)} placeholder="Rilevato automaticamente" /><button className="icon" onClick={browse}><FolderOpen size={16} /></button></div><small>Su Mac cerca Blender in Applicazioni, Desktop e Applicazioni utente.</small></label>
      <details className="advanced-panel settings-advanced"><summary>Progetto avanzato</summary><div className="settings-grid">
        <label className="field"><span>Frame al secondo</span><input type="number" min="1" max="120" value={projectSettings.fps} onChange={(event) => updateSettings({ fps: Number(event.target.value) })} /></label>
        <label className="field"><span>Durata (frame)</span><input type="number" min="1" value={projectSettings.frameEnd} onChange={(event) => updateSettings({ frameEnd: Number(event.target.value) })} /></label>
        <label className="field"><span>Larghezza</span><input type="number" min="1" value={projectSettings.resolutionX} onChange={(event) => updateSettings({ resolutionX: Number(event.target.value) })} /></label>
        <label className="field"><span>Altezza</span><input type="number" min="1" value={projectSettings.resolutionY} onChange={(event) => updateSettings({ resolutionY: Number(event.target.value) })} /></label>
      </div></details>
      {status && <p className="settings-status">{status}</p>}
    </div>
    <footer className="modal-actions"><button className="secondary" onClick={onClose}>Chiudi</button><button className="primary" onClick={save}>Salva impostazioni</button></footer>
  </Modal>;
}
