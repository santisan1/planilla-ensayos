import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Save, Printer, Settings, Download, Activity, Zap, FileSpreadsheet,
  Folder, Plus, Trash2, ArrowLeft, Search, Clock, FileText, CheckCircle, AlertCircle, X, Percent, Shield, Loader2, Cloud, CloudOff
} from 'lucide-react';

// --- FIREBASE IMPORTS ---
import { initializeApp } from "firebase/app";
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import { getFirestore, doc, setDoc, deleteDoc, collection, onSnapshot, query } from "firebase/firestore";

// --- FIREBASE SETUP ---
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// --- UTILIDADES ---
const generateId = () => Math.random().toString(36).substr(2, 9);

// --- COMPONENTE: EDITOR DE PLANILLA ---
const TestSheetEditor = ({ project, onUpdate, onBack }) => {
  // --- ESTADOS LOCALES ---
  const [activeTab, setActiveTab] = useState('ttr');
  const [tapRange, setTapRange] = useState(project.tapRange || 5);

  // Datos TTR y Resistencia
  const [data, setData] = useState(project.data || {});

  // Datos TG Delta
  const [tgDeltaData, setTgDeltaData] = useState(project.tgDeltaData || [
    { id: generateId() }, { id: generateId() }, { id: generateId() }, { id: generateId() }
  ]);

  // Datos Resistencia de Aislación
  const [insulationData, setInsulationData] = useState(project.insulationData ||
    Array(6).fill(null).map(() => ({ id: generateId() }))
  );

  const [headerInfo, setHeaderInfo] = useState(project.headerInfo || {
    manufacturingNumber: '', serialNumber: '', client: '', date: new Date().toISOString().split('T')[0]
  });

  const [resistanceSettings, setResistanceSettings] = useState(project.resistanceSettings || {
    measuredTemp: '20', refTemp: '75', conn1Name: 'Conexión 1', conn2Name: 'Conexión 2', conn3Name: 'Conexión 3'
  });

  const [isSaving, setIsSaving] = useState(false);

  // --- EFECTO DE GUARDADO AUTOMÁTICO (DEBOUNCE) ---
  useEffect(() => {
    setIsSaving(true);
    const updatedProject = {
      ...project,
      tapRange,
      data,
      tgDeltaData,
      insulationData,
      headerInfo,
      resistanceSettings,
      lastModified: new Date().toISOString()
    };

    const timeoutId = setTimeout(() => {
      onUpdate(updatedProject).then(() => setIsSaving(false));
    }, 1000); // Guardar 1 segundo después del último cambio

    return () => clearTimeout(timeoutId);
  }, [tapRange, data, tgDeltaData, insulationData, headerInfo, resistanceSettings]);

  // Cargar scripts externos (PDF/Excel)
  useEffect(() => {
    const loadScript = (src) => {
      if (document.querySelector(`script[src="${src}"]`)) return;
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      document.body.appendChild(script);
    };
    loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js");
    loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
  }, []);

  // --- LÓGICA DE NEGOCIO ---
  const tapRows = useMemo(() => {
    const rows = [];
    for (let i = tapRange; i >= 1; i--) rows.push({ id: `pos-${i}`, label: `+${i}` });
    rows.push({ id: 'neutral', label: '0 (Nominal)' });
    for (let i = 1; i <= tapRange; i++) rows.push({ id: `neg-${i}`, label: `-${i}` });
    return rows;
  }, [tapRange]);

  const handleInputChange = (id, field, value) => {
    const valWithComma = value.replace('.', ',');
    setData(prev => ({ ...prev, [id]: { ...prev[id], [field]: valWithComma } }));
  };

  const handleTgDeltaChange = (id, field, value) => {
    const valFormatted = (field === 'testVoltage' || field === 'tgPercent' || field === 'capacitance')
      ? value.replace('.', ',') : value;
    setTgDeltaData(prev => prev.map(row => row.id === id ? { ...row, [field]: valFormatted } : row));
  };
  const addTgDeltaRow = () => setTgDeltaData(prev => [...prev, { id: generateId() }]);
  const removeTgDeltaRow = (id) => { if (confirm('¿Borrar fila?')) setTgDeltaData(prev => prev.filter(row => row.id !== id)); };

  const handleInsulationChange = (id, field, value) => {
    const numericFields = ['val30s', 'val1m', 'val2m', 'val3m', 'val4m', 'val5m', 'val6m', 'val7m', 'val8m', 'val9m', 'val10m'];
    const valFormatted = numericFields.includes(field) ? value.replace('.', ',') : value;
    setInsulationData(prev => prev.map(row => row.id === id ? { ...row, [field]: valFormatted } : row));
  };
  const addInsulationRow = () => setInsulationData(prev => [...prev, { id: generateId() }]);
  const removeInsulationRow = (id) => { if (confirm('¿Borrar fila?')) setInsulationData(prev => prev.filter(row => row.id !== id)); };

  const parseNum = (val) => val ? parseFloat(String(val).replace(',', '.')) : 0;
  const formatNum = (val, decimals = 3) => (val === null || val === undefined || isNaN(val)) ? '-' : val.toFixed(decimals).replace('.', ',');

  const calculateDeviation = (measured, rated) => {
    const m = parseNum(measured);
    const r = parseNum(rated);
    if (isNaN(m) || isNaN(r) || r === 0) return null;
    return ((m - r) / r) * 100;
  };

  const calculateResistanceCorrection = (measuredVal) => {
    const m = parseNum(measuredVal);
    const t_meas = parseNum(resistanceSettings.measuredTemp);
    const t_ref = parseNum(resistanceSettings.refTemp);
    if (isNaN(m) || isNaN(t_meas) || isNaN(t_ref)) return null;
    return m * ((235 + t_ref) / (235 + t_meas));
  };

  const calculateDAR = (val1m, val30s) => {
    const v1 = parseNum(val1m);
    const v30 = parseNum(val30s);
    if (v30 === 0 || isNaN(v1) || isNaN(v30)) return null;
    return v1 / v30;
  };
  const calculatePI = (val10m, val1m) => {
    const v10 = parseNum(val10m);
    const v1 = parseNum(val1m);
    if (v1 === 0 || isNaN(v10) || isNaN(v1)) return null;
    return v10 / v1;
  };

  const getStatusTTR = (deviation) => {
    if (deviation === null) return { color: 'bg-gray-50 text-gray-400 print:text-gray-400', icon: null };
    const absDev = Math.abs(deviation);
    if (absDev <= 0.5) return { color: 'bg-green-100 text-green-700 font-bold border-green-300 print:bg-gray-100 print:text-black print:border-gray-400', icon: <CheckCircle className="w-4 h-4 inline mr-1 text-green-600 print:hidden" /> };
    return { color: 'bg-red-100 text-red-700 font-bold border-red-300 print:bg-gray-200 print:text-black print:font-bold print:border-black', icon: <AlertCircle className="w-4 h-4 inline mr-1 text-red-600 print:text-black" /> };
  };

  const getStatusTG = (valStr) => {
    if (!valStr) return { color: 'bg-white', icon: null };
    const val = parseNum(valStr);
    if (val < 0.5) return { color: 'bg-green-100 text-green-700 font-bold border-green-300 print:bg-gray-100 print:text-black print:border-gray-400', icon: <CheckCircle className="w-4 h-4 inline mr-1 text-green-600 print:hidden" /> };
    return { color: 'bg-red-100 text-red-700 font-bold border-red-300 print:bg-gray-200 print:text-black print:font-bold print:border-black', icon: <AlertCircle className="w-4 h-4 inline mr-1 text-red-600 print:text-black" /> };
  };

  const getStatusIP = (piValue) => {
    if (piValue === null) return { color: 'bg-white', icon: null, label: '-' };
    if (piValue > 1.0) {
      return {
        color: 'bg-green-100 text-green-700 font-bold border-green-300 print:bg-gray-100 print:text-black print:border-gray-400',
        icon: <CheckCircle className="w-4 h-4 inline mr-1 text-green-600 print:hidden" />,
        label: 'ACEPTABLE'
      };
    }
    return {
      color: 'bg-red-100 text-red-700 font-bold border-red-300 print:bg-gray-200 print:text-black print:font-bold print:border-black',
      icon: <AlertCircle className="w-4 h-4 inline mr-1 text-red-600 print:text-black" />,
      label: 'NO ACEPTABLE'
    };
  };

  // --- EXPORTADORES ---
  const handleDownloadExcel = () => {
    if (!window.XLSX) return alert("Cargando librería Excel...");
    const wb = window.XLSX.utils.book_new();

    // 1. TTR Sheet
    const ttrData = [
      ["PLANILLA DE ENSAYOS - TTR"],
      ["Cliente:", headerInfo.client, "Fecha:", headerInfo.date],
      ["Nº Serie:", headerInfo.serialNumber, "Nº Fab:", headerInfo.manufacturingNumber],
      [], ["Tap", "Ratio %", "Rated Ratio", "Ph A Meas", "Dev A %", "Ph B Meas", "Dev B %", "Ph C Meas", "Dev C %"]
    ];
    tapRows.forEach(row => {
      const d = data[row.id] || {};
      const devA = calculateDeviation(d.phaseA, d.ratedRatio);
      const devB = calculateDeviation(d.phaseB, d.ratedRatio);
      const devC = calculateDeviation(d.phaseC, d.ratedRatio);
      ttrData.push([
        row.label, d.ratioPercent, d.ratedRatio,
        d.phaseA, devA !== null ? formatNum(devA) : "",
        d.phaseB, devB !== null ? formatNum(devB) : "",
        d.phaseC, devC !== null ? formatNum(devC) : ""
      ]);
    });
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(ttrData), "TTR");

    // 2. Resistance Sheet
    const resData = [
      ["PLANILLA DE ENSAYOS - RESISTENCIA"],
      [], ["Tap",
        `${resistanceSettings.conn1Name} (Meas)`, `${resistanceSettings.conn1Name} (Corr)`,
        `${resistanceSettings.conn2Name} (Meas)`, `${resistanceSettings.conn2Name} (Corr)`,
        `${resistanceSettings.conn3Name} (Meas)`, `${resistanceSettings.conn3Name} (Corr)`]
    ];
    tapRows.forEach(row => {
      const d = data[row.id] || {};
      const c1 = calculateResistanceCorrection(d.resConn1Meas);
      const c2 = calculateResistanceCorrection(d.resConn2Meas);
      const c3 = calculateResistanceCorrection(d.resConn3Meas);
      resData.push([
        row.label,
        d.resConn1Meas, c1 !== null ? formatNum(c1, 4) : "",
        d.resConn2Meas, c2 !== null ? formatNum(c2, 4) : "",
        d.resConn3Meas, c3 !== null ? formatNum(c3, 4) : ""
      ]);
    });
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(resData), "Resistencia");

    // 3. TG Delta Sheet
    const tgData = [
      ["PLANILLA DE ENSAYOS - TANGENTE DELTA"],
      [], ["Modo", "Inyección", "Medición", "Guarda", "Tensión Ensayo", "TG (%)", "Cx (pF)"]
    ];
    tgDeltaData.forEach(row => {
      tgData.push([row.mode, row.injection, row.measurement, row.guard, row.testVoltage, row.tgPercent, row.capacitance]);
    });
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(tgData), "TG Delta");

    // 4. Aislación Sheet
    const insData = [
      ["PLANILLA DE ENSAYOS - RESISTENCIA DE AISLACIÓN (GΩ)"],
      [], ["Inyección", "Medición", "Guarda", "30\"", "1'", "2'", "3'", "4'", "5'", "6'", "7'", "8'", "9'", "10'", "RAD (DAR)", "IP (PI)", "Estado IP"]
    ];
    insulationData.forEach(row => {
      const dar = calculateDAR(row.val1m, row.val30s);
      const pi = calculatePI(row.val10m, row.val1m);
      const statusIP = getStatusIP(pi);
      insData.push([
        row.injection, row.measurement, row.guard,
        row.val30s, row.val1m, row.val2m, row.val3m, row.val4m, row.val5m, row.val6m, row.val7m, row.val8m, row.val9m, row.val10m,
        dar !== null ? formatNum(dar, 2) : "",
        pi !== null ? formatNum(pi, 2) : "",
        statusIP.label
      ]);
    });
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(insData), "Aislación");

    window.XLSX.writeFile(wb, `Ensayo_${headerInfo.serialNumber || 'SN'}.xlsx`);
  };

  const handleDownloadPDF = () => {
    const element = document.getElementById('printable-content');
    if (!window.html2pdf) return alert("Cargando librería PDF...");
    document.body.classList.add('generating-pdf');
    const opt = { margin: 5, filename: `Ensayo_${headerInfo.serialNumber || 'SN'}.pdf`, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' } };
    window.html2pdf().set(opt).from(element).save().then(() => document.body.classList.remove('generating-pdf'));
  };

  // --- RENDERIZADO DEL EDITOR ---
  return (
    <div className="animate-in fade-in slide-in-from-right duration-300">
      <style>{`
        @media print { @page { size: landscape; margin: 10mm; } .no-print { display: none !important; } .print-border { border: 1px solid #000 !important; } }
        body.generating-pdf input, body.generating-pdf select { border: none !important; background: transparent !important; padding: 0 !important; text-align: center; appearance: none; }
        input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
      `}</style>

      {/* Barra de Navegación */}
      <div className="bg-gray-800 text-white p-3 flex items-center justify-between sticky top-0 z-50 shadow-md no-print" data-html2canvas-ignore="true">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="flex items-center gap-2 hover:bg-gray-700 px-3 py-1 rounded transition">
            <ArrowLeft size={18} /> <span className="hidden md:inline">Volver a Proyectos</span>
          </button>
          <div className="h-6 w-px bg-gray-600"></div>
          <div>
            <h2 className="font-bold text-sm md:text-base">{headerInfo.client || 'Sin Cliente'}</h2>
            <p className="text-xs text-gray-400">{headerInfo.serialNumber || 'Sin Nro Serie'}</p>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          {isSaving ? (
            <span className="text-xs text-yellow-400 flex items-center gap-1"><Loader2 size={14} className="animate-spin" /> Guardando...</span>
          ) : (
            <span className="text-xs text-green-400 flex items-center gap-1"><Cloud size={14} /> Guardado en Nube</span>
          )}
        </div>
      </div>

      <div id="printable-content" className="max-w-[1400px] mx-auto p-4 bg-gray-100 min-h-screen print:bg-white print:p-0">

        {/* HEADER DOCUMENTO */}
        <header className="bg-white shadow-sm rounded-lg p-6 mb-4 border-l-4 border-blue-600 print:shadow-none print:border-none print:mb-2 print:p-0">
          <div className="flex flex-col md:flex-row justify-between gap-4">
            <div className="w-full">
              <h1 className="text-2xl font-bold text-gray-800 print:text-black mb-1">Planilla de Ensayos Eléctricos</h1>
              <p className="text-gray-500 print:text-gray-700 mb-4 text-sm uppercase tracking-wide font-semibold">
                {activeTab === 'ttr' ? 'Relación de Transformación (TTR)' :
                  activeTab === 'resistance' ? 'Resistencia de Devanados' :
                    activeTab === 'tgdelta' ? 'Factor de Potencia / TG Delta' :
                      'Resistencia de Aislación'}
              </p>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-gray-50 p-3 rounded border border-gray-200 print:bg-white print:border-black print:border-2 print:p-2 text-sm">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nº Fabricación</label>
                  <input type="text" className="w-full p-1 bg-white border border-gray-300 rounded font-bold uppercase"
                    value={headerInfo.manufacturingNumber} onChange={(e) => setHeaderInfo({ ...headerInfo, manufacturingNumber: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nº Serie</label>
                  <input type="text" className="w-full p-1 bg-white border border-gray-300 rounded font-bold uppercase"
                    value={headerInfo.serialNumber} onChange={(e) => setHeaderInfo({ ...headerInfo, serialNumber: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Cliente / Proyecto</label>
                  <input type="text" className="w-full p-1 bg-white border border-gray-300 rounded uppercase"
                    value={headerInfo.client} onChange={(e) => setHeaderInfo({ ...headerInfo, client: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Fecha</label>
                  <input type="date" className="w-full p-1 bg-white border border-gray-300 rounded"
                    value={headerInfo.date} onChange={(e) => setHeaderInfo({ ...headerInfo, date: e.target.value })} />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 no-print min-w-[160px]" data-html2canvas-ignore="true">
              <button onClick={handleDownloadPDF} className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded shadow text-xs uppercase font-bold tracking-wide w-full justify-center">
                <Download size={16} /> Descargar PDF
              </button>
              <button onClick={handleDownloadExcel} className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded shadow text-xs uppercase font-bold tracking-wide w-full justify-center">
                <FileSpreadsheet size={16} /> Exportar Excel
              </button>
            </div>
          </div>
        </header>

        {/* CONTROLES TABS */}
        <div className="bg-white p-3 rounded-lg shadow mb-4 no-print flex flex-wrap items-center gap-6 border border-gray-200" data-html2canvas-ignore="true">
          {(activeTab === 'ttr' || activeTab === 'resistance') && (
            <div className="flex items-center gap-3">
              <Settings className="text-gray-400" />
              <div>
                <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Configurar Taps (+/-)</label>
                <select value={tapRange} onChange={(e) => setTapRange(parseInt(e.target.value))}
                  className="block w-32 border-gray-300 rounded border p-1 text-sm bg-gray-50">
                  {[...Array(17).keys()].map(num => <option key={num} value={num}>+/- {num}</option>)}
                </select>
              </div>
            </div>
          )}

          <div className="flex bg-gray-100 p-1 rounded-lg ml-auto overflow-x-auto">
            <button onClick={() => setActiveTab('ttr')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold transition-all whitespace-nowrap ${activeTab === 'ttr' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              <Zap size={16} /> TTR
            </button>
            <button onClick={() => setActiveTab('resistance')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold transition-all whitespace-nowrap ${activeTab === 'resistance' ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              <Activity size={16} /> Resistencia
            </button>
            <button onClick={() => setActiveTab('tgdelta')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold transition-all whitespace-nowrap ${activeTab === 'tgdelta' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              <Percent size={16} /> TG Delta
            </button>
            <button onClick={() => setActiveTab('insulation')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold transition-all whitespace-nowrap ${activeTab === 'insulation' ? 'bg-white text-teal-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              <Shield size={16} /> Aislación
            </button>
          </div>
        </div>

        {/* --- VISTA: TTR --- */}
        {activeTab === 'ttr' && (
          <div className="bg-white shadow-lg rounded-lg overflow-hidden border border-gray-200 print:shadow-none print:border-black print:border-2 animate-in fade-in slide-in-from-bottom-2">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-800 text-white print:bg-gray-300 print:text-black border-b print:border-black">
                    <th colSpan="3" className="py-2 px-2 border-r border-gray-600 print:border-black text-center font-semibold">REFERENCIA</th>
                    <th colSpan="6" className="py-2 px-2 text-center font-semibold bg-blue-900 print:bg-gray-300 print:text-black">MEDICIONES (3 FASES)</th>
                  </tr>
                  <tr className="bg-gray-100 text-gray-700 text-xs uppercase font-bold text-center border-b-2 border-gray-300 print:border-black print:text-black">
                    <th className="py-2 px-1 w-12 border-r border-gray-300 print:border-black">Tap</th>
                    <th className="py-2 px-1 w-20 border-r border-gray-300 print:border-black">Ratio %</th>
                    <th className="py-2 px-1 w-24 border-r border-gray-400 print:border-black bg-yellow-50 print:bg-white">Teórico</th>
                    <th className="py-2 px-1 w-24 bg-blue-50 print:bg-white border-r print:border-black">Fase A</th>
                    <th className="py-2 px-1 w-16 border-r border-gray-300 print:border-black bg-blue-50 print:bg-white">Dev A</th>
                    <th className="py-2 px-1 w-24 bg-blue-50 print:bg-white border-r print:border-black">Fase B</th>
                    <th className="py-2 px-1 w-16 border-r border-gray-300 print:border-black bg-blue-50 print:bg-white">Dev B</th>
                    <th className="py-2 px-1 w-24 bg-blue-50 print:bg-white border-r print:border-black">Fase C</th>
                    <th className="py-2 px-1 w-16 bg-blue-50 print:bg-white">Dev C</th>
                  </tr>
                </thead>
                <tbody>
                  {tapRows.map((row, index) => {
                    const rowData = data[row.id] || {};
                    const devA = calculateDeviation(rowData.phaseA, rowData.ratedRatio);
                    const devB = calculateDeviation(rowData.phaseB, rowData.ratedRatio);
                    const devC = calculateDeviation(rowData.phaseC, rowData.ratedRatio);
                    const statusA = getStatusTTR(devA);
                    const statusB = getStatusTTR(devB);
                    const statusC = getStatusTTR(devC);

                    return (
                      <tr key={row.id} className={`${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'} print:bg-white border-b border-gray-200 print:border-gray-300`}>
                        <td className="py-1 px-2 border-r border-gray-300 print:border-black text-center font-bold text-gray-700 print:text-black">{row.label}</td>
                        <td className="py-1 px-1 border-r border-gray-300 print:border-black">
                          <input type="text" className="w-full p-1 border border-gray-300 rounded text-center text-xs" value={rowData.ratioPercent || ''} onChange={(e) => handleInputChange(row.id, 'ratioPercent', e.target.value)} />
                        </td>
                        <td className="py-1 px-1 border-r border-gray-400 print:border-black bg-yellow-50/50 print:bg-white">
                          <input type="text" inputMode="decimal" className="w-full p-1 border border-yellow-300 bg-yellow-50 rounded text-center font-bold text-xs" value={rowData.ratedRatio || ''} onChange={(e) => handleInputChange(row.id, 'ratedRatio', e.target.value)} />
                        </td>
                        <td className="py-1 px-1 border-r print:border-black border-gray-200"><input type="text" inputMode="decimal" className="w-full p-1 border border-gray-300 rounded text-center text-xs" value={rowData.phaseA || ''} onChange={(e) => handleInputChange(row.id, 'phaseA', e.target.value)} /></td>
                        <td className={`py-1 px-1 border-r border-gray-300 print:border-black text-center ${statusA.color} print:border`}>{statusA.icon} {devA !== null ? formatNum(devA) : '-'}%</td>
                        <td className="py-1 px-1 border-r print:border-black border-gray-200"><input type="text" inputMode="decimal" className="w-full p-1 border border-gray-300 rounded text-center text-xs" value={rowData.phaseB || ''} onChange={(e) => handleInputChange(row.id, 'phaseB', e.target.value)} /></td>
                        <td className={`py-1 px-1 border-r border-gray-300 print:border-black text-center ${statusB.color} print:border`}>{statusB.icon} {devB !== null ? formatNum(devB) : '-'}%</td>
                        <td className="py-1 px-1 border-r print:border-black border-gray-200"><input type="text" inputMode="decimal" className="w-full p-1 border border-gray-300 rounded text-center text-xs" value={rowData.phaseC || ''} onChange={(e) => handleInputChange(row.id, 'phaseC', e.target.value)} /></td>
                        <td className={`py-1 px-1 text-center ${statusC.color} print:border`}>{statusC.icon} {devC !== null ? formatNum(devC) : '-'}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* --- VISTA: RESISTENCIA --- */}
        {activeTab === 'resistance' && (
          <div className="bg-white shadow-lg rounded-lg overflow-hidden border border-gray-200 print:shadow-none print:border-black print:border-2 animate-in fade-in slide-in-from-bottom-2">
            <div className="bg-purple-50 p-3 border-b border-purple-200 grid grid-cols-1 md:grid-cols-2 gap-4 print:bg-white print:border-black print:border-b-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase text-purple-900 w-32">Temp. Observada:</span>
                <input type="text" inputMode="decimal" value={resistanceSettings.measuredTemp} onChange={(e) => setResistanceSettings({ ...resistanceSettings, measuredTemp: e.target.value.replace('.', ',') })} className="w-20 p-1 border border-purple-300 rounded text-center font-bold" />
                <span className="text-sm text-purple-800">°C</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase text-purple-900 w-32">Temp. Referencia:</span>
                <input type="text" inputMode="decimal" value={resistanceSettings.refTemp} onChange={(e) => setResistanceSettings({ ...resistanceSettings, refTemp: e.target.value.replace('.', ',') })} className="w-20 p-1 border border-purple-300 rounded text-center font-bold" />
                <span className="text-sm text-purple-800">°C</span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-xs">
                <thead>
                  <tr className="bg-purple-900 text-white print:bg-gray-300 print:text-black border-b print:border-black">
                    <th className="py-2 px-2 border-r border-purple-700 print:border-black w-16">POS</th>
                    <th colSpan="2" className="py-2 px-2 border-r border-purple-700 print:border-black text-center">
                      <input type="text" value={resistanceSettings.conn1Name} onChange={(e) => setResistanceSettings({ ...resistanceSettings, conn1Name: e.target.value })} className="bg-transparent text-white print:text-black text-center font-bold w-full focus:outline-none placeholder-purple-300" placeholder="Nombre Conexión 1" />
                    </th>
                    <th colSpan="2" className="py-2 px-2 border-r border-purple-700 print:border-black text-center">
                      <input type="text" value={resistanceSettings.conn2Name} onChange={(e) => setResistanceSettings({ ...resistanceSettings, conn2Name: e.target.value })} className="bg-transparent text-white print:text-black text-center font-bold w-full focus:outline-none placeholder-purple-300" placeholder="Nombre Conexión 2" />
                    </th>
                    <th colSpan="2" className="py-2 px-2 text-center">
                      <input type="text" value={resistanceSettings.conn3Name} onChange={(e) => setResistanceSettings({ ...resistanceSettings, conn3Name: e.target.value })} className="bg-transparent text-white print:text-black text-center font-bold w-full focus:outline-none placeholder-purple-300" placeholder="Nombre Conexión 3" />
                    </th>
                  </tr>
                  <tr className="bg-gray-100 text-gray-700 text-xs uppercase font-bold text-center border-b-2 border-gray-300 print:border-black print:text-black">
                    <th className="py-2 px-1 border-r border-gray-300 print:border-black">Tap</th>
                    <th className="py-2 px-1 w-32 border-r border-gray-300 print:border-black">Valor a {resistanceSettings.measuredTemp}°C</th>
                    <th className="py-2 px-1 w-32 border-r border-gray-400 print:border-black bg-purple-50 print:bg-white">Corr. a {resistanceSettings.refTemp}°C</th>
                    <th className="py-2 px-1 w-32 border-r border-gray-300 print:border-black">Valor a {resistanceSettings.measuredTemp}°C</th>
                    <th className="py-2 px-1 w-32 border-r border-gray-400 print:border-black bg-purple-50 print:bg-white">Corr. a {resistanceSettings.refTemp}°C</th>
                    <th className="py-2 px-1 w-32 border-r border-gray-300 print:border-black">Valor a {resistanceSettings.measuredTemp}°C</th>
                    <th className="py-2 px-1 w-32 bg-purple-50 print:bg-white">Corr. a {resistanceSettings.refTemp}°C</th>
                  </tr>
                </thead>
                <tbody>
                  {tapRows.map((row, index) => {
                    const rowData = data[row.id] || {};
                    const c1 = calculateResistanceCorrection(rowData.resConn1Meas);
                    const c2 = calculateResistanceCorrection(rowData.resConn2Meas);
                    const c3 = calculateResistanceCorrection(rowData.resConn3Meas);
                    return (
                      <tr key={row.id} className={`${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'} print:bg-white border-b border-gray-200 print:border-gray-300`}>
                        <td className="py-1 px-2 border-r border-gray-300 print:border-black text-center font-bold text-gray-700 print:text-black">{row.label}</td>
                        <td className="py-1 px-1 border-r border-gray-300 print:border-black"><input type="text" inputMode="decimal" className="w-full p-1 border border-gray-300 rounded text-center text-xs" value={rowData.resConn1Meas || ''} onChange={(e) => handleInputChange(row.id, 'resConn1Meas', e.target.value)} /></td>
                        <td className="py-1 px-1 border-r border-gray-400 print:border-black bg-purple-50/30 text-center font-mono text-blue-800 font-bold">{c1 !== null ? formatNum(c1, 4) : '-'}</td>
                        <td className="py-1 px-1 border-r border-gray-300 print:border-black"><input type="text" inputMode="decimal" className="w-full p-1 border border-gray-300 rounded text-center text-xs" value={rowData.resConn2Meas || ''} onChange={(e) => handleInputChange(row.id, 'resConn2Meas', e.target.value)} /></td>
                        <td className="py-1 px-1 border-r border-gray-400 print:border-black bg-purple-50/30 text-center font-mono text-blue-800 font-bold">{c2 !== null ? formatNum(c2, 4) : '-'}</td>
                        <td className="py-1 px-1 border-r border-gray-300 print:border-black"><input type="text" inputMode="decimal" className="w-full p-1 border border-gray-300 rounded text-center text-xs" value={rowData.resConn3Meas || ''} onChange={(e) => handleInputChange(row.id, 'resConn3Meas', e.target.value)} /></td>
                        <td className="py-1 px-1 bg-purple-50/30 text-center font-mono text-blue-800 font-bold">{c3 !== null ? formatNum(c3, 4) : '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* --- VISTA: TG DELTA --- */}
        {activeTab === 'tgdelta' && (
          <div className="bg-white shadow-lg rounded-lg overflow-hidden border border-gray-200 print:shadow-none print:border-black print:border-2 animate-in fade-in slide-in-from-bottom-2">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] border-collapse text-xs">
                <thead>
                  <tr className="bg-orange-800 text-white print:bg-gray-300 print:text-black border-b print:border-black">
                    <th rowSpan="2" className="py-2 px-3 border-r border-orange-700 print:border-black w-24">MODO</th>
                    <th colSpan="3" className="py-1 px-2 border-r border-orange-700 print:border-black text-center bg-orange-900 print:bg-gray-400">CONEXIONES</th>
                    <th rowSpan="2" className="py-2 px-2 border-r border-orange-700 print:border-black w-32">TENSIÓN ENSAYO</th>
                    <th rowSpan="2" className="py-2 px-2 border-r border-orange-700 print:border-black w-32">TG (%)</th>
                    <th rowSpan="2" className="py-2 px-2 w-32">Cx (pF)</th>
                    <th rowSpan="2" className="py-2 px-1 w-10 no-print"></th>
                  </tr>
                  <tr className="bg-gray-100 text-gray-700 text-xs uppercase font-bold text-center border-b-2 border-gray-300 print:border-black print:text-black">
                    <th className="py-2 px-2 border-r border-gray-300 print:border-black w-24">INYECCIÓN</th>
                    <th className="py-2 px-2 border-r border-gray-300 print:border-black">MEDICIÓN</th>
                    <th className="py-2 px-2 border-r border-gray-300 print:border-black">GUARDA</th>
                  </tr>
                </thead>
                <tbody>
                  {tgDeltaData.map((row) => {
                    const status = getStatusTG(row.tgPercent);
                    return (
                      <tr key={row.id} className="bg-white border-b border-gray-200 print:border-gray-300">
                        <td className="py-1 px-1 border-r border-gray-300 print:border-black">
                          <select value={row.mode || ''} onChange={(e) => handleTgDeltaChange(row.id, 'mode', e.target.value)} className="w-full p-1 border-none bg-transparent text-center font-bold text-gray-700 focus:outline-none">
                            <option value="">-</option><option value="UST">UST</option><option value="GST g">GST g</option><option value="GST-GND">GST-GND</option>
                          </select>
                        </td>
                        <td className="py-1 px-1 border-r border-gray-300 print:border-black">
                          <select value={row.injection || ''} onChange={(e) => handleTgDeltaChange(row.id, 'injection', e.target.value)} className="w-full p-1 border-none bg-transparent text-center text-gray-700 focus:outline-none">
                            <option value="">-</option><option value="AT">AT</option><option value="MT">MT</option><option value="BT">BT</option>
                          </select>
                        </td>
                        <td className="py-1 px-1 border-r border-gray-300 print:border-black"><input type="text" className="w-full p-1 border-none text-center focus:outline-none" value={row.measurement || ''} onChange={(e) => handleTgDeltaChange(row.id, 'measurement', e.target.value)} /></td>
                        <td className="py-1 px-1 border-r border-gray-300 print:border-black"><input type="text" className="w-full p-1 border-none text-center focus:outline-none" value={row.guard || ''} onChange={(e) => handleTgDeltaChange(row.id, 'guard', e.target.value)} /></td>
                        <td className="py-1 px-1 border-r border-gray-300 print:border-black"><input type="text" inputMode="decimal" className="w-full p-1 border-none text-center font-semibold focus:outline-none" placeholder="0" value={row.testVoltage || ''} onChange={(e) => handleTgDeltaChange(row.id, 'testVoltage', e.target.value)} /></td>
                        <td className={`py-1 px-1 border-r border-gray-300 print:border-black text-center ${status.color} print:border`}><div className="flex items-center justify-center gap-1">{status.icon}<input type="text" inputMode="decimal" className="w-20 p-1 border-none bg-transparent text-center font-bold focus:outline-none" placeholder="%" value={row.tgPercent || ''} onChange={(e) => handleTgDeltaChange(row.id, 'tgPercent', e.target.value)} /></div></td>
                        <td className="py-1 px-1 print:border-black"><input type="text" inputMode="decimal" className="w-full p-1 border-none text-center focus:outline-none" placeholder="pF" value={row.capacitance || ''} onChange={(e) => handleTgDeltaChange(row.id, 'capacitance', e.target.value)} /></td>
                        <td className="py-1 px-1 text-center no-print"><button onClick={() => removeTgDeltaRow(row.id)} className="text-gray-300 hover:text-red-500 transition"><X size={14} /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="bg-gray-100 px-6 py-2 border-t border-gray-200 print:bg-white text-xs text-gray-500 flex justify-between items-center">
              <span>* TG aceptable si es menor a 0,5%</span>
              <button onClick={addTgDeltaRow} className="flex items-center gap-1 text-orange-700 font-bold hover:text-orange-900 no-print"><Plus size={14} /> Agregar Fila</button>
            </div>
          </div>
        )}

        {/* --- VISTA: AISLACIÓN (CON ESTADO IP) --- */}
        {activeTab === 'insulation' && (
          <div className="bg-white shadow-lg rounded-lg overflow-hidden border border-gray-200 print:shadow-none print:border-black print:border-2 animate-in fade-in slide-in-from-bottom-2">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1300px] border-collapse text-xs">
                <thead>
                  <tr className="bg-teal-800 text-white print:bg-gray-300 print:text-black border-b print:border-black">
                    <th colSpan="3" className="py-1 px-2 border-r border-teal-700 print:border-black text-center bg-teal-900 print:bg-gray-400">CONEXIÓN</th>
                    <th colSpan="11" className="py-2 px-2 border-r border-teal-700 print:border-black text-center">RESULTADOS EN GΩ</th>
                    <th colSpan="3" className="py-2 px-2 border-r border-teal-700 print:border-black text-center bg-teal-900 print:bg-gray-400">ÍNDICES</th>
                    <th rowSpan="2" className="py-2 px-1 w-8 no-print"></th>
                  </tr>
                  <tr className="bg-gray-100 text-gray-700 text-xs uppercase font-bold text-center border-b-2 border-gray-300 print:border-black print:text-black">
                    <th className="py-2 px-1 border-r border-gray-300 print:border-black w-20">INY</th>
                    <th className="py-2 px-1 border-r border-gray-300 print:border-black w-24">MED</th>
                    <th className="py-2 px-1 border-r border-gray-300 print:border-black w-24">GDA</th>

                    <th className="py-2 px-1 border-r border-gray-300 print:border-black w-14">30"</th>
                    <th className="py-2 px-1 border-r border-gray-300 print:border-black w-14">1'</th>
                    <th className="py-2 px-1 border-r border-gray-300 print:border-black w-14">2'</th>
                    <th className="py-2 px-1 border-r border-gray-300 print:border-black w-14">3'</th>
                    <th className="py-2 px-1 border-r border-gray-300 print:border-black w-14">4'</th>
                    <th className="py-2 px-1 border-r border-gray-300 print:border-black w-14">5'</th>
                    <th className="py-2 px-1 border-r border-gray-300 print:border-black w-14">6'</th>
                    <th className="py-2 px-1 border-r border-gray-300 print:border-black w-14">7'</th>
                    <th className="py-2 px-1 border-r border-gray-300 print:border-black w-14">8'</th>
                    <th className="py-2 px-1 border-r border-gray-300 print:border-black w-14">9'</th>
                    <th className="py-2 px-1 border-r border-gray-300 print:border-black w-14">10'</th>

                    <th className="py-2 px-1 border-r border-gray-300 print:border-black w-16 bg-yellow-50 print:bg-white">RAD</th>
                    <th className="py-2 px-1 border-r border-gray-300 print:border-black w-16 bg-yellow-50 print:bg-white">IP</th>
                    <th className="py-2 px-1 w-24 bg-gray-50 print:bg-white">Estado IP</th>
                  </tr>
                </thead>
                <tbody>
                  {insulationData.map((row) => {
                    const dar = calculateDAR(row.val1m, row.val30s);
                    const pi = calculatePI(row.val10m, row.val1m);
                    const statusIP = getStatusIP(pi);

                    return (
                      <tr key={row.id} className="bg-white border-b border-gray-200 print:border-gray-300">
                        {/* CONEXIÓN */}
                        <td className="py-1 px-1 border-r border-gray-300 print:border-black">
                          <select value={row.injection || ''} onChange={(e) => handleInsulationChange(row.id, 'injection', e.target.value)} className="w-full p-1 border-none bg-transparent text-center text-xs font-bold text-gray-700 focus:outline-none">
                            <option value="">-</option><option value="AT">AT</option><option value="MT">MT</option><option value="BT">BT</option>
                          </select>
                        </td>
                        <td className="py-1 px-1 border-r border-gray-300 print:border-black"><input type="text" className="w-full p-1 border-none text-center text-xs focus:outline-none" value={row.measurement || ''} onChange={(e) => handleInsulationChange(row.id, 'measurement', e.target.value)} /></td>
                        <td className="py-1 px-1 border-r border-gray-300 print:border-black"><input type="text" className="w-full p-1 border-none text-center text-xs focus:outline-none" value={row.guard || ''} onChange={(e) => handleInsulationChange(row.id, 'guard', e.target.value)} /></td>

                        {/* RESULTADOS GΩ */}
                        <td className="py-1 px-1 border-r border-gray-300 print:border-black"><input type="text" inputMode="decimal" className="w-full p-1 border-none text-center text-xs focus:outline-none" value={row.val30s || ''} onChange={(e) => handleInsulationChange(row.id, 'val30s', e.target.value)} /></td>
                        <td className="py-1 px-1 border-r border-gray-300 print:border-black"><input type="text" inputMode="decimal" className="w-full p-1 border-none text-center text-xs focus:outline-none" value={row.val1m || ''} onChange={(e) => handleInsulationChange(row.id, 'val1m', e.target.value)} /></td>
                        <td className="py-1 px-1 border-r border-gray-300 print:border-black"><input type="text" inputMode="decimal" className="w-full p-1 border-none text-center text-xs focus:outline-none" value={row.val2m || ''} onChange={(e) => handleInsulationChange(row.id, 'val2m', e.target.value)} /></td>
                        <td className="py-1 px-1 border-r border-gray-300 print:border-black"><input type="text" inputMode="decimal" className="w-full p-1 border-none text-center text-xs focus:outline-none" value={row.val3m || ''} onChange={(e) => handleInsulationChange(row.id, 'val3m', e.target.value)} /></td>
                        <td className="py-1 px-1 border-r border-gray-300 print:border-black"><input type="text" inputMode="decimal" className="w-full p-1 border-none text-center text-xs focus:outline-none" value={row.val4m || ''} onChange={(e) => handleInsulationChange(row.id, 'val4m', e.target.value)} /></td>
                        <td className="py-1 px-1 border-r border-gray-300 print:border-black"><input type="text" inputMode="decimal" className="w-full p-1 border-none text-center text-xs focus:outline-none" value={row.val5m || ''} onChange={(e) => handleInsulationChange(row.id, 'val5m', e.target.value)} /></td>
                        <td className="py-1 px-1 border-r border-gray-300 print:border-black"><input type="text" inputMode="decimal" className="w-full p-1 border-none text-center text-xs focus:outline-none" value={row.val6m || ''} onChange={(e) => handleInsulationChange(row.id, 'val6m', e.target.value)} /></td>
                        <td className="py-1 px-1 border-r border-gray-300 print:border-black"><input type="text" inputMode="decimal" className="w-full p-1 border-none text-center text-xs focus:outline-none" value={row.val7m || ''} onChange={(e) => handleInsulationChange(row.id, 'val7m', e.target.value)} /></td>
                        <td className="py-1 px-1 border-r border-gray-300 print:border-black"><input type="text" inputMode="decimal" className="w-full p-1 border-none text-center text-xs focus:outline-none" value={row.val8m || ''} onChange={(e) => handleInsulationChange(row.id, 'val8m', e.target.value)} /></td>
                        <td className="py-1 px-1 border-r border-gray-300 print:border-black"><input type="text" inputMode="decimal" className="w-full p-1 border-none text-center text-xs focus:outline-none" value={row.val9m || ''} onChange={(e) => handleInsulationChange(row.id, 'val9m', e.target.value)} /></td>
                        <td className="py-1 px-1 border-r border-gray-300 print:border-black"><input type="text" inputMode="decimal" className="w-full p-1 border-none text-center text-xs focus:outline-none" value={row.val10m || ''} onChange={(e) => handleInsulationChange(row.id, 'val10m', e.target.value)} /></td>

                        {/* ÍNDICES CALCULADOS */}
                        <td className="py-1 px-1 border-r border-gray-300 print:border-black bg-yellow-50/50 text-center font-bold text-xs text-blue-800">
                          {dar !== null ? formatNum(dar, 2) : '-'}
                        </td>
                        <td className="py-1 px-1 border-r border-gray-300 print:border-black bg-yellow-50/50 text-center font-bold text-xs text-blue-800">
                          {pi !== null ? formatNum(pi, 2) : '-'}
                        </td>

                        {/* ESTADO IP */}
                        <td className={`py-1 px-1 text-center font-bold text-[10px] uppercase ${statusIP.color} print:border-black print:border`}>
                          <div className="flex items-center justify-center gap-1">
                            {statusIP.icon}
                            <span>{statusIP.label}</span>
                          </div>
                        </td>

                        <td className="py-1 px-1 text-center no-print">
                          <button onClick={() => removeInsulationRow(row.id)} className="text-gray-300 hover:text-red-500 transition"><X size={14} /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="bg-gray-100 px-6 py-2 border-t border-gray-200 print:bg-white text-xs text-gray-500 flex justify-between items-center">
              <span>* IP Aceptable si es mayor a 1.0 (RAD = 1' / 30" | IP = 10' / 1')</span>
              <button onClick={addInsulationRow} className="flex items-center gap-1 text-teal-700 font-bold hover:text-teal-900 no-print"><Plus size={14} /> Agregar Fila</button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

// --- DASHBOARD DE PROYECTOS ---
const ProjectDashboard = ({ projects, onCreate, onSelect, onDelete }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  useEffect(() => {
    if (confirmDeleteId) {
      const timer = setTimeout(() => setConfirmDeleteId(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [confirmDeleteId]);

  const filteredProjects = projects.filter(p =>
    p.headerInfo.client?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.headerInfo.serialNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.headerInfo.manufacturingNumber?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-50 p-6 font-sans">
      <div className="max-w-6xl mx-auto">
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-4">
          <div><h1 className="text-3xl font-bold text-gray-800 flex items-center gap-2"><Folder className="text-blue-600" size={32} /> Gestión de Ensayos</h1><p className="text-gray-500 mt-1">Administra tus mediciones de transformadores (Nube)</p></div>
          <button onClick={onCreate} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-2 transition font-semibold"><Plus size={20} /> Nuevo Proyecto</button>
        </header>
        <div className="mb-8 relative"><Search className="absolute left-3 top-3 text-gray-400" size={20} /><input type="text" placeholder="Buscar..." className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg shadow-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} /></div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div onClick={onCreate} className="border-2 border-dashed border-gray-300 rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition min-h-[280px] group">
            <div className="bg-gray-100 p-4 rounded-full mb-4 group-hover:bg-blue-200 transition"><Plus className="text-gray-500 group-hover:text-blue-600" size={32} /></div><h3 className="text-lg font-semibold text-gray-600 group-hover:text-blue-700">Crear Nuevo Ensayo</h3>
          </div>
          {filteredProjects.map(project => (
            <div key={project.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition flex flex-col relative group overflow-hidden min-h-[280px]">
              <div onClick={() => onSelect(project)} className="cursor-pointer flex-1 flex flex-col h-full">
                <div className="flex justify-between items-start mb-6"><div className="bg-blue-50 text-blue-700 border border-blue-100 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide">{project.headerInfo.client || 'Sin Cliente'}</div><div className="text-xs text-gray-400 flex items-center gap-1"><Clock size={12} />{new Date(project.lastModified).toLocaleDateString()}</div></div>
                <div className="space-y-6 mb-6 flex-1"><div><p className="text-xs text-gray-400 uppercase font-bold tracking-wider mb-1">Nº Serie</p><h3 className="text-4xl font-black text-gray-800 break-words leading-none tracking-tight">{project.headerInfo.serialNumber || <span className="text-gray-300 text-2xl">S/N -</span>}</h3></div><div><p className="text-xs text-gray-400 uppercase font-bold tracking-wider mb-1">Nº Fabricación</p><h3 className="text-3xl font-bold text-gray-600 break-words leading-none">{project.headerInfo.manufacturingNumber || <span className="text-gray-300 text-xl">FAB -</span>}</h3></div></div>
                <div className="pt-4 border-t border-gray-100 flex items-center gap-4 text-sm text-gray-500 mt-auto"><div className="flex items-center gap-1 bg-gray-50 px-2 py-1 rounded"><Settings size={14} className="text-gray-400" /> <span className="font-semibold">Taps: +/- {project.tapRange}</span></div></div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); if (confirmDeleteId === project.id) { onDelete(project.id); } else { setConfirmDeleteId(project.id); } }} className={`absolute bottom-4 right-4 p-2 rounded-full transition-all duration-200 shadow-sm border z-20 flex items-center gap-2 ${confirmDeleteId === project.id ? 'bg-red-500 text-white hover:bg-red-600 border-red-600 w-auto px-3' : 'bg-white text-gray-300 hover:text-red-500 border-gray-100 hover:border-red-200'}`} title="Eliminar"><Trash2 size={20} />{confirmDeleteId === project.id && <span className="text-xs font-bold animate-in fade-in">¿Seguro?</span>}</button>
            </div>
          ))}
        </div>
        {filteredProjects.length === 0 && searchTerm === '' && projects.length > 0 && <div className="text-center py-12 text-gray-500">No hay proyectos creados.</div>}
      </div>
    </div>
  );
};

// --- COMPONENTE PRINCIPAL ---
const App = () => {
  const [user, setUser] = useState(null);
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [loading, setLoading] = useState(true);

  // 1. Inicializar Auth
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (e) {
        console.error("Error autenticando:", e);
      }
    };
    initAuth();
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) setLoading(false);
    });
  }, []);

  // 2. Suscribirse a Datos (Firestore)
  useEffect(() => {
    if (!user) return;
    setLoading(true);
    const SHARED_UID = "empresa-demo-001";
    const q = query(
      collection(db, 'artifacts', appId, 'users', SHARED_UID, 'projects'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const projectsData = snapshot.docs.map(doc => doc.data());
      // Ordenar localmente por fecha de modificación
      projectsData.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
      setProjects(projectsData);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching projects:", error);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [user]);

  // 3. CRUD Handlers (Firestore)
  const handleCreateProject = async () => {
    if (!user) return;
    const newId = generateId();
    const newProject = {
      id: newId, lastModified: new Date().toISOString(), tapRange: 5,
      headerInfo: { manufacturingNumber: '', serialNumber: '', client: '', date: new Date().toISOString().split('T')[0] },
      data: {}, resistanceSettings: { measuredTemp: '20', refTemp: '75', conn1Name: 'Conexión 1', conn2Name: 'Conexión 2', conn3Name: 'Conexión 3' },
      tgDeltaData: Array(4).fill(null).map(() => ({ id: generateId() })),
      insulationData: Array(6).fill(null).map(() => ({ id: generateId() }))
    };
    try {
      await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'projects', newId), newProject);
      setActiveProjectId(newId);
    } catch (e) { console.error("Error creating:", e); }
  };

  const handleUpdateProject = async (project) => {
    if (!user) return;
    try {
      await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'projects', project.id), project);
    } catch (e) { console.error("Error updating:", e); }
  };

  const handleDeleteProject = async (id) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'projects', id));
      if (activeProjectId === id) setActiveProjectId(null);
    } catch (e) { console.error("Error deleting:", e); }
  };

  if (loading) return <div className="h-screen flex items-center justify-center text-gray-500"><Loader2 className="animate-spin mr-2" /> Cargando base de datos...</div>;

  if (activeProjectId) {
    const activeProject = projects.find(p => p.id === activeProjectId);
    if (!activeProject) return <div>Error. <button onClick={() => setActiveProjectId(null)}>Volver</button></div>;
    // Usamos key={activeProject.id} para forzar re-render completo al cambiar de proyecto
    return <TestSheetEditor key={activeProject.id} project={activeProject} onUpdate={handleUpdateProject} onBack={() => setActiveProjectId(null)} />;
  }

  return <ProjectDashboard projects={projects} onCreate={handleCreateProject} onSelect={(p) => setActiveProjectId(p.id)} onDelete={handleDeleteProject} />;
};

export default App;