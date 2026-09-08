import { useState } from 'react';

export default function Sidebar({
  notes,
  selectedFolder,
  setSelectedFolder,
  viewMode,
  setViewMode,
  onCloseSidebar,
  onSignOut,
  isSigningOut,
}) {
  const [folders, setFolders] = useState([
    { id: 'all',   label: 'MySpace (All)' },
    { id: 'notes', label: 'Notes' },
  ]);

  // États pour la modale "New folder"
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [folderName, setFolderName] = useState('New folder');
  const [isSmartFolder, setIsSmartFolder] = useState(false);

  // Gestion des lignes de filtres dynamiques (image_eb9aeb.png, image_eba64e.png)
  const [filterRows, setFilterRows] = useState([
    { id: crypto.randomUUID(), type: 'Filters', contentMode: 'All filters', textValue: '' }
  ]);

  const countForFolder = (fid) => {
    if (fid === 'all') return notes.length;
    const foundFolder = folders.find(f => f.id === fid);
    if (foundFolder && foundFolder.label === 'New') return 1; // Correspond à la maquette image_eb9f07.png
    return notes.filter((n) => n.folder === 'Notes').length;
  };

  // Ajouter une nouvelle ligne de filtre (Bouton +)
  const addFilterRow = () => {
    setFilterRows([
      ...filterRows,
      { id: crypto.randomUUID(), type: 'Modif date', contentMode: 'Today', textValue: '' }
    ]);
  };

  // Supprimer une ligne de filtre (Bouton -)
  const removeFilterRow = (id) => {
    if (filterRows.length > 1) {
      setFilterRows(filterRows.filter(row => row.id !== id));
    }
  };

  // Mettre à jour une ligne de filtre spécifique
  const updateFilterRow = (id, fields) => {
    setFilterRows(filterRows.map(row => row.id === id ? { ...row, ...fields } : row));
  };

  const handleSaveFolder = () => {
    if (!folderName.trim()) return;
    
    setFolders((prev) => [
      ...prev, 
      { 
        id: folderName.toLowerCase().replace(/\s+/g, '-'), 
        label: folderName,
        isSmart: isSmartFolder 
      }
    ]);

    // Réinitialisation globale après sauvegarde (image_eb9f07.png)
    setFolderName('New folder');
    setIsSmartFolder(false);
    setFilterRows([{ id: crypto.randomUUID(), type: 'Filters', contentMode: 'All filters', textValue: '' }]);
    setIsModalOpen(false);
  };

  return (
    <>
      <aside className="sidebar" style={{ background: '#ffffff' }}>
        {/* Ligne du haut : point vert + boutons vue */}
        <div className="sidebar-top-row">
          <div className="green-dot" />
          <div
            className="view-icons"
            style={{
              position: 'relative',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              overflow: 'hidden',
            }}
          >
            {/* Fond blanc animé qui glisse entre Liste et Grille
                (couleur alignée sur le blanc de la page, avec une légère
                ombre pour rester visible sur le fond gris clair de la barre). */}
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                top: '4px',
                bottom: '4px',
                left: viewMode === 'grid' ? '50%' : '4px',
                width: 'calc(50% - 4px)',
                borderRadius: '12px',
                background: '#ffffff',
                boxShadow: '0 2px 5px rgba(0, 0, 0, 0.15)',
                transition: 'left 280ms cubic-bezier(0.22, 1, 0.36, 1)',
                pointerEvents: 'none',
                zIndex: 0,
              }}
            />

            <button
              className="view-btn"
              title="List view"
              onClick={() => setViewMode('list')}
              aria-pressed={viewMode === 'list'}
              style={{
                position: 'relative',
                zIndex: 1,
                background: 'transparent',
                boxShadow: 'none',
                transition: 'color 180ms ease, transform 180ms ease',
                color: viewMode === 'list' ? '#000000' : '#3f3f46',
                transform: viewMode === 'list' ? 'scale(1.04)' : 'scale(1)',
              }}
            >
              <i
                className="fa-solid fa-list"
                style={{ color: viewMode === 'list' ? '#000000' : '#3f3f46' }}
              ></i>
            </button>
            <button
              className="view-btn"
              title="Masquer la barre latérale"
              onClick={() => {
                setViewMode('grid');
                onCloseSidebar?.();
              }}
              aria-pressed={viewMode === 'grid'}
              style={{
                position: 'relative',
                zIndex: 1,
                background: 'transparent',
                boxShadow: 'none',
                transition: 'color 180ms ease, transform 180ms ease',
                color: viewMode === 'grid' ? '#000000' : '#3f3f46',
                transform: viewMode === 'grid' ? 'scale(1.04)' : 'scale(1)',
              }}
            >
              <i
                className="fa-solid fa-grip"
                style={{ color: viewMode === 'grid' ? '#000000' : '#3f3f46' }}
              ></i>
            </button>
          </div>
        </div>

        {/* Section Shared */}
        <div className="sidebar-shared-row">
          <div className="shared-avatar">
            <i className="fa-solid fa-user"></i>
          </div>
          <span className="shared-label">Shared</span>
          <span className="shared-count">0</span>
        </div>

        {/* Section MySpace */}
        <div className="sidebar-section">
          <div className="section-title">MySpace</div>
          <ul className="folder-list" id="folder-list">
            {folders.map((f) => (
              <li
                key={f.id}
                className={selectedFolder === f.id ? 'active' : ''}
                onClick={() => setSelectedFolder(f.id)}
              >
                <span className="folder-item-left">
                  <i className={f.isSmart ? "fa-solid fa-gear" : "fa-regular fa-folder"}></i>
                  <span>{f.label}</span>
                </span>
                <span className="folder-count">{countForFolder(f.id)}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Déconnexion */}
        <button
          type="button"
          className="btn-sidebar-signout"
          onClick={onSignOut}
          disabled={isSigningOut}
          title="Se déconnecter"
        >
          <i className="fa-solid fa-arrow-right-from-bracket" />
          <span>{isSigningOut ? 'Déconnexion…' : 'Déconnexion'}</span>
        </button>

        {/* Nouveau dossier */}
        <button className="btn-new-folder" onClick={() => setIsModalOpen(true)}>
          <span className="new-folder-icon">+</span>
          New folder
        </button>
      </aside>

      {/* ════════════════════════════════════════════════════════════
          MODAL WINDOW : NEW FOLDER
      ════════════════════════════════════════════════════════════ */}
      {isModalOpen && (
        <div className="modal-overlay" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.3)', display: 'flex',
          justifyContent: 'center', alignItems: 'center', zIndex: 9999
        }}>
          <div className="mac-modal-container" style={{
            background: '#ffffff', borderRadius: '24px', width: '480px',
            padding: '24px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
          }}>
            
            <h2 style={{ fontSize: '16px', fontWeight: 'bold', margin: '0 0 20px 0', color: '#000' }}>
              New folder
            </h2>

            {/* Saisie du nom */}
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
              <label style={{ width: '65px', fontSize: '13px', color: '#555' }}>Name :</label>
              <input 
                type="text" 
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                style={{
                  flex: 1, padding: '5px 10px', borderRadius: '6px',
                  border: '1px solid #ffbc00', outline: 'none', fontSize: '13px'
                }}
              />
            </div>

            {/* Checkbox Smart Folder */}
            <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '16px' }}>
              <input 
                type="checkbox" 
                id="smartFolder"
                checked={isSmartFolder}
                onChange={(e) => setIsSmartFolder(e.target.checked)}
                style={{ marginTop: '3px', marginRight: '10px', cursor: 'pointer' }}
              />
              <div>
                <label htmlFor="smartFolder" style={{ fontSize: '13px', fontWeight: '600', color: '#000', cursor: 'pointer' }}>
                  Convert to smart folder
                </label>
                <p style={{ fontSize: '12px', color: '#777', margin: '2px 0 0 0' }}>
                  Organize your reminders using tags and other filters.
                </p>
              </div>
            </div>

            {/* SECTION MULTI-FILTRES DYNAMIQUES (CORRIGÉE VISUELLEMENT) */}
            {isSmartFolder && (
              <div style={{ borderTop: '1px solid #e5e5e5', paddingTop: '14px', marginBottom: '20px' }}>
                <p style={{ fontSize: '13px', fontWeight: '600', margin: '0 0 12px 0', color: '#000' }}>
                  Include notes corresponding to the following filters:
                </p>
                
                {filterRows.map((row) => (
                  <div 
                    key={row.id} 
                    style={{ 
                      display: 'flex', 
                      gap: '8px', 
                      alignItems: 'center', 
                      marginBottom: '10px',
                      width: '100%'
                    }}
                  >
                    
                    {/* Premier sélecteur (Type principal) */}
                    <select 
                      value={row.type}
                      onChange={(e) => updateFilterRow(row.id, { type: e.target.value })}
                      style={{ 
                        padding: '4px 8px', borderRadius: '6px', border: '1px solid #ccc', 
                        backgroundColor: '#fff', fontSize: '12px', width: '110px' 
                      }}
                    >
                      <option value="Filters">Filters</option>
                      <option value="Modif date">Modif date</option>
                      <option value="Creation date">Creation date</option>
                      <option value="By Traffic Lights Colors">By Traffic Lights Colors</option>
                      <option value="Shared Notes">Shared Notes</option>
                      <option value="Locked Notes">Locked Notes</option>
                      <option value="Notes with Lists">Notes with Lists</option>
                    </select>

                    {/* Deuxième sélecteur adaptatif (image_eb9b81.png) */}
                    <select 
                      value={row.contentMode}
                      onChange={(e) => updateFilterRow(row.id, { contentMode: e.target.value })}
                      style={{ 
                        padding: '4px 8px', borderRadius: '6px', border: '1px solid #ccc', 
                        backgroundColor: '#fff', fontSize: '12px', width: '110px' 
                      }}
                    >
                      {row.type === 'Modif date' || row.type === 'Creation date' ? (
                        <>
                          <option value="Today">Today</option>
                          <option value="Yesterday">Yesterday</option>
                          <option value="Last 7 days">Last 7 days</option>
                          <option value="Last 30 days">Last 30 days</option>
                          <option value="Last 3 months">Last 3 months</option>
                          <option value="Last 12 months">Last 12 months</option>
                          <option value="Specific range">Specific range</option>
                        </>
                      ) : (
                        <>
                          <option value="All filters">All filters</option>
                          <option value="Any selected filter">Any selected filter</option>
                          <option value="Notes without filter only">Notes without filter only</option>
                        </>
                      )}
                    </select>

                    {/* Input text OU Espaceur invisible pour stabiliser la position des boutons */}
                    {row.type === 'Filters' ? (
                      <input 
                        type="text"
                        value={row.textValue}
                        onChange={(e) => updateFilterRow(row.id, { textValue: e.target.value })}
                        style={{ 
                          flex: 1, minWidth: '60px', padding: '4px 8px', 
                          borderRadius: '6px', border: '1px solid #ccc', fontSize: '12px' 
                        }}
                      />
                    ) : (
                      <div style={{ flex: 1 }} />
                    )}

                    {/* Groupe de boutons d'action aligné et figé à droite */}
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                      <button 
                        onClick={() => removeFilterRow(row.id)}
                        style={{ 
                          width: '22px', height: '22px', borderRadius: '50%', border: '1px solid #ccc', 
                          background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', 
                          justifyContent: 'center', fontSize: '14px', lineHeight: 1
                        }}
                      >
                        -
                      </button>
                      <button 
                        onClick={addFilterRow}
                        style={{ 
                          width: '22px', height: '22px', borderRadius: '50%', border: '1px solid #ccc', 
                          background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', 
                          justifyContent: 'center', fontSize: '14px', lineHeight: 1
                        }}
                      >
                        +
                      </button>
                    </div>

                  </div>
                ))}
              </div>
            )}

            {/* Boutons d'action bas de modale */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '20px' }}>
              <button 
                onClick={() => setIsModalOpen(false)}
                style={{
                  padding: '6px 20px', borderRadius: '8px', border: '1px solid #b3b3b3',
                  background: '#fff', color: '#000', fontSize: '13px', fontWeight: '500', cursor: 'pointer'
                }}
              >
                Back
              </button>
              <button 
                onClick={handleSaveFolder}
                style={{
                  padding: '6px 20px', borderRadius: '8px', border: 'none',
                  background: 'linear-gradient(to bottom, #a1c4fd 0%, #c2e9fb 100%)', 
                  color: '#fff', fontSize: '13px', fontWeight: '600', cursor: 'pointer',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                }}
              >
                Save
              </button>
            </div>

          </div>
        </div>
      )}
    </>
  );
}