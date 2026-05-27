import React, { useState, useMemo } from 'react';

// ==========================================
// CONSTANTS & RULE DEFINITIONS
// ==========================================
const EXCLUSIONS = {
  SAT_BEFORE_2ND_SUN: 'SAT_BEFORE_2ND_SUN',
  THIRD_SUNDAY: 'THIRD_SUNDAY',
};

const EXCLUSION_LABELS = {
  [EXCLUSIONS.SAT_BEFORE_2ND_SUN]: 'Exclude Saturday before 2nd Sunday',
  [EXCLUSIONS.THIRD_SUNDAY]: 'Exclude 3rd Sunday',
};

// ==========================================
// DATE HELPER FUNCTIONS
// ==========================================
const parseLocalDate = (dateStr) => new Date(dateStr + 'T00:00:00');

const checkExclusion = (dateStr, exclusionType) => {
  const d = parseLocalDate(dateStr);
  const dayOfWeek = d.getDay(); // 0 = Sunday, 6 = Saturday
  const dayOfMonth = d.getDate();

  if (exclusionType === EXCLUSIONS.THIRD_SUNDAY) {
    // 3rd Sunday always falls between the 15th and 21st
    return dayOfWeek === 0 && dayOfMonth >= 15 && dayOfMonth <= 21;
  }

  if (exclusionType === EXCLUSIONS.SAT_BEFORE_2ND_SUN) {
    if (dayOfWeek !== 6) return false;
    // Check if the next day is the 2nd Sunday (which falls between the 8th and 14th)
    const nextDay = dayOfMonth + 1;
    return nextDay >= 8 && nextDay <= 14;
  }

  return false;
};

export default function App() {
  // ==========================================
  // STATE MANAGEMENT
  // ==========================================
  const [readers, setReaders] = useState([]);
  const [selectedDates, setSelectedDates] = useState({}); // { "YYYY-MM-DD": readerCount }
  const [assignments, setAssignments] = useState({}); // { "YYYY-MM-DD": { lector1: id, lector2: id } }
  
  // Form States
  const [newReaderName, setNewReaderName] = useState('');
  const [newReaderPhone, setNewReaderPhone] = useState('');
  const [newReaderPartner, setNewReaderPartner] = useState('');
  const [newReaderExclusions, setNewReaderExclusions] = useState([]);

  // Calendar Navigation State (Defaulting to June 2026)
  const [currentYear, setCurrentYear] = useState(2026);
  const [currentMonth, setCurrentMonth] = useState(5); // 0-indexed (5 = June)

  // ==========================================
  // STAGE 1: CALENDAR & DATE SELECTION HANDLERS
  // ==========================================
  const daysInMonth = useMemo(() => {
    return new Date(currentYear, currentMonth + 1, 0).getDate();
  }, [currentYear, currentMonth]);

  const firstDayOffset = useMemo(() => {
    return new Date(currentYear, currentMonth, 1).getDay();
  }, [currentYear, currentMonth]);

  const handleDateClick = (dateStr) => {
    setSelectedDates((prev) => {
      const next = { ...prev };
      if (next[dateStr] !== undefined) {
        delete next[dateStr];
        setAssignments((prevAsg) => {
          const nextAsg = { ...prevAsg };
          delete nextAsg[dateStr];
          return nextAsg;
        });
      } else {
        next[dateStr] = 2; // Default to 2 readers
      }
      return next;
    });
  };

  const handleReaderCountChange = (dateStr, count) => {
    setSelectedDates((prev) => ({ ...prev, [dateStr]: Math.max(0, count) }));
    setAssignments((prev) => {
      const next = { ...prev };
      if (count === 0) delete next[dateStr];
      else if (count === 1 && next[dateStr]) next[dateStr].lector2 = null;
      return next;
    });
  };

  // ==========================================
  // STAGE 2: READER POOL HANDLERS
  // ==========================================
  const handleAddReader = (e) => {
    e.preventDefault();
    if (!newReaderName.trim()) return;

    const id = 'r_' + Date.now();
    const newReader = {
      id,
      name: newReaderName.trim(),
      phone: newReaderPhone.trim(),
      partnerId: newReaderPartner || null,
      exclusions: newReaderExclusions,
    };

    setReaders((prev) => {
      const updated = [...prev, newReader];
      // Sync mutual partnership if a partner was selected
      if (newReaderPartner) {
        return updated.map((r) =>
          r.id === newReaderPartner ? { ...r, partnerId: id } : r
        );
      }
      return updated;
    });

    // Reset Form
    setNewReaderName('');
    setNewReaderPhone('');
    setNewReaderPartner('');
    setNewReaderExclusions([]);
  };

  const handleDeleteReader = (id) => {
    setReaders((prev) =>
      prev
        .filter((r) => r.id !== id)
        .map((r) => (r.partnerId === id ? { ...r, partnerId: null } : r))
    );
  };

  const handleToggleExclusion = (rule) => {
    setNewReaderExclusions((prev) =>
      prev.includes(rule) ? prev.filter((r) => r !== rule) : [...prev, rule]
    );
  };

  // ==========================================
  // STAGE 3: AUTOMATIC ASSIGNMENT ALGORITHM
  // ==========================================
  const handleAutoAssign = () => {
    const sortedDates = Object.keys(selectedDates).sort();
    const currentAssignments = {};
    const runningShiftCounts = {};
    
    readers.forEach(r => { runningShiftCounts[r.id] = 0; });

    // Helper: Shuffle array randomly
    const shuffle = (array) => [...array].sort(() => Math.random() - 0.5);

    for (let i = 0; i < sortedDates.length; i++) {
      const dateStr = sortedDates[i];
      const needed = selectedDates[dateStr];
      if (needed === 0) continue;

      currentAssignments[dateStr] = { lector1: null, lector2: null };
      const prevDateStr = sortedDates[i - 1];
      const yesterdayIds = prevDateStr && currentAssignments[prevDateStr]
        ? [currentAssignments[prevDateStr].lector1, currentAssignments[prevDateStr].lector2].filter(Boolean)
        : [];

      // 1. Filter out completely excluded or consecutive readers
      let availablePool = readers.filter((reader) => {
        if (yesterdayIds.includes(reader.id)) return false; // Rule: No consecutive days
        return !reader.exclusions.some((exc) => checkExclusion(dateStr, exc)); // Rule: Exclusion constraints
      });

      // 2. Sort by shift count to maintain equity, then randomize ties
      const sortPool = (pool) => {
        return shuffle(pool).sort((a, b) => runningShiftCounts[a.id] - runningShiftCounts[b.id]);
      };

      availablePool = sortPool(availablePool);

      let assignedCount = 0;
      while (assignedCount < needed && availablePool.length > 0) {
        const primaryCandidate = availablePool[0];

        // Check for Grouping Rule (Pairs)
        if (primaryCandidate.partnerId && needed === 2 && assignedCount === 0) {
          const partner = availablePool.find(r => r.id === primaryCandidate.partnerId);
          if (partner) {
            currentAssignments[dateStr].lector1 = primaryCandidate.id;
            currentAssignments[dateStr].lector2 = partner.id;
            runningShiftCounts[primaryCandidate.id]++;
            runningShiftCounts[partner.id]++;
            assignedCount += 2;
            availablePool = sortPool(availablePool.filter(r => r.id !== primaryCandidate.id && r.id !== partner.id));
            continue;
          }
        }

        // Standard Single Assignment
        if (assignedCount === 0) {
          currentAssignments[dateStr].lector1 = primaryCandidate.id;
        } else {
          currentAssignments[dateStr].lector2 = primaryCandidate.id;
        }
        runningShiftCounts[primaryCandidate.id]++;
        assignedCount++;
        availablePool = sortPool(availablePool.filter(r => r.id !== primaryCandidate.id));
      }
    }

    setAssignments(currentAssignments);
  };

  const handleManualOverride = (dateStr, slot, readerId) => {
    setAssignments((prev) => ({
      ...prev,
      [dateStr]: {
        ...prev[dateStr],
        [slot]: readerId || null,
      },
    }));
  };

  // ==========================================
  // STAGE 4: FILE PERSISTENCE (SAVE / LOAD)
  // ==========================================
  const handleExportJSON = () => {
    const dataStr = JSON.stringify({ readers, selectedDates, assignments }, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `schedule-backup-${currentYear}-${currentMonth + 1}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJSON = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        if (parsed.readers) setReaders(parsed.readers);
        if (parsed.selectedDates) setSelectedDates(parsed.selectedDates);
        if (parsed.assignments) setAssignments(parsed.assignments);
      } catch (err) {
        alert('Invalid file format. Could not restore backup configurations.');
      }
    };
    reader.readAsText(file);
  };

  // ==========================================
  // STAGE 5: PRINT COMPONENT RENDER CONFIG
  // ==========================================
  const handlePrint = () => {
    window.print();
  };

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  return (
    <div style={{ padding: '20px', fontFamily: 'system-ui, sans-serif', maxWidth: '1200px', margin: '0 auto' }}>
      
      {/* CSS Print Directives Override */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-full-width { width: 100% !important; max-width: 100% !important; }
          body { color: #000; background: #fff; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { border: 1px solid #000; padding: 12px; text-align: left; }
        }
      `}</style>

      {/* INTERACTIVE WEB LAYOUT */}
      <div className="no-print">
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', borderBottom: '2px solid #eaeaea', paddingBottom: '15px' }}>
          <h2>Dynamic Scheduling Application</h2>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={handleExportJSON} style={{ padding: '8px 14px', cursor: 'pointer', backgroundColor: '#0070f3', color: '#fff', border: 'none', borderRadius: '4px' }}>Save System Configurations</button>
            <label style={{ padding: '8px 14px', cursor: 'pointer', backgroundColor: '#eaeaea', borderRadius: '4px', border: '1px solid #ccc' }}>
              Upload Configuration Backup
              <input type="file" accept=".json" onChange={handleImportJSON} style={{ display: 'none' }} />
            </label>
            <button onClick={handlePrint} style={{ padding: '8px 14px', cursor: 'pointer', backgroundColor: '#222', color: '#fff', border: 'none', borderRadius: '4px' }}>Print View Dashboard</button>
          </div>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', marginBottom: '40px' }}>
          {/* STAGE 1: CALENDAR VIEW COMPONENT */}
          <section style={{ border: '1px solid #eaeaea', padding: '20px', borderRadius: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <h3 style={{ margin: 0 }}>{monthNames[currentMonth]} {currentYear}</h3>
              <div style={{ display: 'flex', gap: '5px' }}>
                <button onClick={() => { if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(y => y - 1); } else { setCurrentMonth(m => m - 1); } }} style={{ cursor: 'pointer' }}>◀</button>
                <button onClick={() => { if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(y => y + 1); } else { setCurrentMonth(m => m + 1); } }} style={{ cursor: 'pointer' }}>▶</button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '5px', textAlign: 'center', fontWeight: 'bold', marginBottom: '10px' }}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d}>{d}</div>)}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '5px' }}>
              {Array.from({ length: firstDayOffset }).map((_, i) => <div key={`empty-${i}`} />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const isSelected = selectedDates[dateStr] !== undefined;

                return (
                  <button
                    key={dateStr}
                    onClick={() => handleDateClick(dateStr)}
                    style={{
                      padding: '12px 0',
                      borderRadius: '4px',
                      border: '1px solid #ccc',
                      cursor: 'pointer',
                      backgroundColor: isSelected ? '#e3f2fd' : '#fff',
                      fontWeight: isSelected ? 'bold' : 'normal',
                      borderColor: isSelected ? '#0070f3' : '#ccc',
                    }}
                  >
                    {day}
                    {isSelected && <div style={{ fontSize: '10px', color: '#0070f3' }}>Slots: {selectedDates[dateStr]}</div>}
                  </button>
                );
              })}
            </div>
          </section>

          {/* STAGE 2: MANAGEMENT COMPONENT FOR THE READER POOL */}
          <section style={{ border: '1px solid #eaeaea', padding: '20px', borderRadius: '8px' }}>
            <h3 style={{ marginTop: 0 }}>Register Core Reader Directory</h3>
            <form onSubmit={handleAddReader} style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
              <input type="text" placeholder="Full Name" value={newReaderName} onChange={e => setNewReaderName(e.target.value)} style={{ padding: '8px' }} />
              <input type="text" placeholder="Phone Number" value={newReaderPhone} onChange={e => setNewReaderPhone(e.target.value)} style={{ padding: '8px' }} />
              
              <select value={newReaderPartner} onChange={e => setNewReaderPartner(e.target.value)} style={{ padding: '8px' }}>
                <option value="">No Scheduling Partner (Solo)</option>
                {readers.filter(r => !r.partnerId).map(r => (
                  <option key={r.id} value={r.id}>Link Partner Alignment: {r.name}</option>
                ))}
              </select>

              <div style={{ padding: '5px 0' }}>
                <span style={{ fontSize: '14px', fontWeight: 'bold' }}>Dynamic Rules Ruleset Assignment:</span>
                {Object.keys(EXCLUSIONS).map(key => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '5px', fontSize: '13px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={newReaderExclusions.includes(key)} onChange={() => handleToggleExclusion(key)} />
                    {EXCLUSION_LABELS[key]}
                  </label>
                ))}
              </div>

              <button type="submit" style={{ padding: '10px', backgroundColor: '#222', color: '#fff', border: 'none', cursor: 'pointer', borderRadius: '4px' }}>Save New Profile Member</button>
            </form>

            <div style={{ maxHeight: '180px', overflowY: 'auto', borderTop: '1px solid #eee', paddingTop: '10px' }}>
              <h4 style={{ margin: '0 0 10px 0' }}>Active Registry Directory</h4>
              {readers.length === 0 ? <p style={{ color: '#777', fontSize: '14px' }}>No accounts verified in current local database pool.</p> : (
                <table style={{ width: '100%', fontSize: '13px', textAlign: 'left' }}>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Constraints</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {readers.map(r => (
                      <tr key={r.id}>
                        <td>{r.name} {r.partnerId && <span style={{ fontSize: '11px', color: '#666' }}>(Linked)</span>}</td>
                        <td>{r.exclusions.length || 0} constraints active</td>
                        <td>
                          <button type="button" onClick={() => handleDeleteReader(r.id)} style={{ color: 'red', border: 'none', background: 'none', cursor: 'pointer' }}>Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>

        {/* STAGE 3: INTERACTIVE MATRIX OVERRIDE ACTION BLOCK */}
        <section style={{ border: '1px solid #eaeaea', padding: '20px', borderRadius: '8px', marginBottom: '30px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h3 style={{ margin: 0 }}>Active Roster Assignment Configurations</h3>
            <button onClick={handleAutoAssign} disabled={readers.length === 0 || Object.keys(selectedDates).length === 0} style={{ padding: '10px 20px', backgroundColor: '#0070f3', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
              Execute Automated Logic Engines
            </button>
          </div>

          {Object.keys(selectedDates).length === 0 ? <p style={{ color: '#777' }}>Please toggle distribution execution days on calendar asset system metrics above.</p> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              {Object.keys(selectedDates).sort().map((dateStr) => {
                const requiredCount = selectedDates[dateStr];
                const assignment = assignments[dateStr] || { lector1: null, lector2: null };

                return (
                  <div key={dateStr} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #eee', paddingBottom: '10px' }}>
                    <div style={{ width: '150px' }}>
                      <strong style={{ display: 'block' }}>{dateStr}</strong>
                      <span style={{ fontSize: '12px', color: '#666' }}>Target Volume Need:</span>
                      <input type="number" min="0" max="2" value={requiredCount} onChange={(e) => handleReaderCountChange(dateStr, parseInt(e.target.value) || 0)} style={{ width: '45px', marginLeft: '5px' }} />
                    </div>

                    <div style={{ display: 'flex', gap: '20px', flexGrow: 1, justifyContent: 'flex-start', marginLeft: '30px' }}>
                      {requiredCount > 0 && (
                        <label style={{ fontSize: '13px' }}>
                          Lector Role 1:
                          <select value={assignment.lector1 || ''} onChange={(e) => handleManualOverride(dateStr, 'lector1', e.target.value)} style={{ marginLeft: '5px', padding: '5px' }}>
                            <option value="">Unassigned</option>
                            {readers.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                        </label>
                      )}
                      {requiredCount > 1 && (
                        <label style={{ fontSize: '13px' }}>
                          Lector Role 2:
                          <select value={assignment.lector2 || ''} onChange={(e) => handleManualOverride(dateStr, 'lector2', e.target.value)} style={{ marginLeft: '5px', padding: '5px' }}>
                            <option value="">Unassigned</option>
                            {readers.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                        </label>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* STAGE 5: SYSTEM PRINT RENDERING DOM LAYER */}
      <main className="print-full-width" style={{ display: 'none', display: 'block' }}>
        <div style={{ borderBottom: '2px solid #000', paddingBottom: '5px', marginBottom: '25px' }}>
          <h1 style={{ margin: 0, fontSize: '24px', textAlign: 'center' }}>Event Distribution Reader System Manifest</h1>
          <p style={{ margin: '5px 0 0 0', textAlign: 'center', fontSize: '14px', color: '#333' }}>
            System Matrix Configurations: {monthNames[currentMonth]} {currentYear}
          </p>
        </div>

        {Object.keys(selectedDates).length === 0 ? (
          <p style={{ textAlign: 'center', fontStyle: 'italic' }}>No active records configuration found for the specified calendar parameters.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#f2f2f2' }}>
                <th style={{ border: '1px solid #ddd', padding: '10px' }}>Event Target Date</th>
                <th style={{ border: '1px solid #ddd', padding: '10px' }}>Primary Assignment (Lector 1)</th>
                <th style={{ border: '1px solid #ddd', padding: '10px' }}>Secondary Assignment (Lector 2)</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(selectedDates).sort().map((dateStr) => {
                const totalReq = selectedDates[dateStr];
                const details = assignments[dateStr];
                
                const lector1Name = readers.find(r => r.id === details?.lector1);
                const lector2Name = readers.find(r => r.id === details?.lector2);

                return (
                  <tr key={dateStr}>
                    <td style={{ border: '1px solid #ddd', padding: '10px', fontWeight: 'bold' }}>{dateStr}</td>
                    <td style={{ border: '1px solid #ddd', padding: '10px' }}>
                      {totalReq > 0 ? (
                        lector1Name ? `${lector1Name.name} ${lector1Name.phone ? `(${lector1Name.phone})` : ''}` : 'Vacant'
                      ) : (
                        <span style={{ color: '#aaa', fontStyle: 'italic' }}>Not Required</span>
                      )}
                    </td>
                    <td style={{ border: '1px solid #ddd', padding: '10px' }}>
                      {totalReq > 1 ? (
                        lector2Name ? `${lector2Name.name} ${lector2Name.phone ? `(${lector2Name.phone})` : ''}` : 'Vacant'
                      ) : (
                        <span style={{ color: '#aaa', fontStyle: 'italic' }}>Not Required</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </main>

    </div>
  );
}