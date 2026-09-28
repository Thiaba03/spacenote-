import { useEffect, useState, useRef } from 'react';
import { COLOR_PALETTES } from '../constants/colors';
import { supabase } from '../lib/supabase';
import bas1 from './bas1.png';
import bas2 from './bas2.png';
import bas3 from './bas3.png';
import SharedNotesInbox from './SharedNotesInbox';

const LINK_SUGGESTIONS = [
  {
    id: 1, title: '(10) PARTYNEXTDOOR &...', source: 'Google Chrome',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    type: 'youtube', thumbnail: 'https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
    siteName: 'youtube.com', description: 'PARTYNEXTDOOR & DRAKE - LASERS',
  },
];

const LIST_PREFIXES = {
  disc: '• ',
  circle: '◦ ',
  num: '1. ',
  diamond: '◆ ',
  arrow: '→ ',
  check: '☐ ',
  checkmark: '✓ ',
};

const LIST_PREFIX_PATTERN = /^(?:[•◦◆→✓☐☑]\s+|\d+\.\s+)/;

// ── Détermine la première et la dernière ligne touchées par la sélection ──
// (comportement Word : une action de liste ne s'applique qu'à la ligne du
// curseur, ou à toutes les lignes couvertes par une sélection multi-lignes).
const getSelectedLineRange = (text, selStart, selEnd) => {
  const lines = text.split('\n');
  let charCount = 0;
  let startLine = 0;
  let endLine = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const lineStart = charCount;
    const lineEnd = charCount + lines[i].length;
    if (selStart >= lineStart && selStart <= lineEnd) startLine = i;
    if (selEnd >= lineStart && selEnd <= lineEnd) endLine = i;
    charCount = lineEnd + 1;
  }
  return [startLine, endLine];
};

const DEFAULT_TEXT_FORMAT = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  style: 'body',
  fontFamily: 'Arial, sans-serif',
  fontSize: 15,
  color: '#000000',
  backgroundColor: 'transparent',
  align: 'left',
};

const FONT_OPTIONS = [
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: '"Times New Roman", serif' },
  { label: 'Courier New', value: '"Courier New", monospace' },
  { label: 'Monaco', value: 'Monaco, monospace' },
];

const bytesToBase64 = (bytes) => {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return window.btoa(binary);
};

const base64ToBytes = (value) => {
  const binary = window.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const createPasswordSalt = () => {
  const salt = new Uint8Array(16);
  window.crypto.getRandomValues(salt);
  return bytesToBase64(salt);
};

const derivePasswordHash = async (passwordValue, saltValue) => {
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passwordValue),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derivedBits = await window.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: base64ToBytes(saltValue),
      iterations: 210000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return bytesToBase64(new Uint8Array(derivedBits));
};

const hashesMatch = (firstHash, secondHash) => {
  if (!firstHash || !secondHash || firstHash.length !== secondHash.length) return false;
  let difference = 0;
  for (let index = 0; index < firstHash.length; index += 1) {
    difference |= firstHash.charCodeAt(index) ^ secondHash.charCodeAt(index);
  }
  return difference === 0;
};

// ── Style de scroll réutilisable pour le corps des cartes ────────────────
// overflowY: 'auto' fait apparaître le défilement seulement si nécessaire,
// scrollbarWidth/scrollbarColor rendent la barre visible sur Firefox,
// et la classe CSS injectée plus bas gère le style sur Chrome/Safari.
const SCROLLABLE_BODY_STYLE = {
  overflowY: 'scroll',
  overflowX: 'hidden',
  minHeight: 0,
  WebkitOverflowScrolling: 'touch',
  overscrollBehavior: 'contain',
  scrollbarWidth: 'thin',
  scrollbarColor: 'rgba(0,0,0,0.35) rgba(0,0,0,0.06)',
};

export default function NoteEditor({
  notes, setNotes, selectedId,
}) {
  const [openDD, setOpenDD]           = useState(null);
  const [searchOpen, setSearchOpen]   = useState(false);
  const [lockStep, setLockStep]       = useState(null);
  const [password, setPassword]       = useState('');
  const [lockMode, setLockMode]       = useState('custom');
  const [lockError, setLockError]     = useState('');
  const [lockBusy, setLockBusy]       = useState(false);
  const [showLockPassword, setShowLockPassword] = useState(false);
  const [linkInput, setLinkInput]     = useState('');
  const [linkError, setLinkError]     = useState('');
  const [listTypesByCard, setListTypesByCard] = useState({});
  const [mediaModal, setMediaModal]   = useState(false);
  const [mediaTab, setMediaTab]       = useState('photos');
  const [selectedImg, setSelectedImg] = useState(null);
  // Carte/slide actuellement ciblée pour les médias : 0 = première carte.
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const [mediaSearch, setMediaSearch] = useState('');
  const [mediaAssets, setMediaAssets] = useState([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [tableCtxMenu, setTableCtxMenu] = useState(null);
  const fileInputRef = useRef(null);
  const mainTextareaRef = useRef(null);

  useEffect(() => {
    if (!mediaModal) return undefined;
    let cancelled = false;

    const loadMediaAssets = async () => {
      setMediaLoading(true);
      const { data, error } = await supabase
        .from('media_assets')
        .select('*')
        .order('created_at', { ascending: false });

      if (cancelled) return;
      if (error) {
        console.error('Impossible de charger la médiathèque :', error);
        setMediaAssets([]);
        setMediaLoading(false);
        return;
      }

      const assetsWithUrls = await Promise.all((data || []).map(async (asset) => {
        const { data: signedData, error: signedError } = await supabase.storage
          .from('note-images')
          .createSignedUrl(asset.path, 3600);
        return { ...asset, src: signedError ? '' : signedData.signedUrl };
      }));

      if (!cancelled) {
        setMediaAssets(assetsWithUrls);
        setMediaLoading(false);
      }
    };

    loadMediaAssets();
    return () => { cancelled = true; };
  }, [mediaModal]);

  // ── Modal renommage interne ──────────────────────────────────────────────
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [tempTitle, setTempTitle] = useState('');

  // ── Partage Supabase ──────────────────────────────────────────────────────
  const [shareProfiles, setShareProfiles] = useState([]);
  const [shareProfilesLoading, setShareProfilesLoading] = useState(false);
  const [shareRecipientId, setShareRecipientId] = useState(null);
  const [shareMode, setShareMode] = useState('copy');
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState('');
  const [shareSuccess, setShareSuccess] = useState('');
  const [showSharedInbox, setShowSharedInbox] = useState(false);

  const loadShareProfiles = async () => {
    setShareProfilesLoading(true);
    setShareError('');
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      setShareProfiles([]);
      setShareProfilesLoading(false);
      setShareError('Vous devez être connecté pour partager une note.');
      return;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url')
      .neq('id', user.id)
      .order('display_name', { ascending: true });

    if (error) {
      console.error('Impossible de charger les contacts :', error);
      setShareProfiles([]);
      setShareError(`Impossible de charger les contacts : ${error.message}`);
    } else {
      setShareProfiles(data || []);
    }
    setShareProfilesLoading(false);
  };

  // Tente d'ouvrir le panneau de partage natif du système (Web Share API).
  // Retourne true si le panneau natif a été utilisé (ou annulé par l'utilisateur).
  const shareNoteNative = async () => {
    if (!note) return false;
    if (!navigator.share) return false;

    try {
      await navigator.share({
        title: note.title || 'Note sans titre',
        text: (note.text || '').slice(0, 500),
      });
      return true;
    } catch (err) {
      if (err.name === 'AbortError') return true; // l'utilisateur a annulé : pas de menu de secours
      console.error('Erreur de partage natif :', err);
      return false;
    }
  };

  const openShareMenu = async () => {
    const opening = openDD !== 'share';

    if (opening) {
      const sharedNatively = await shareNoteNative();
      if (sharedNatively) return; // panneau natif utilisé, pas besoin du menu custom
    }

    setShareError('');
    setShareSuccess('');
    setShareRecipientId(null);
    if (opening && shareProfiles.length === 0) {
      await loadShareProfiles();
    }
    setOpenDD(opening ? 'share' : null);
  };

  const createNoteShare = async (recipientId, permission = 'editor') => {
    if (!note || !recipientId || shareBusy) return;

    setShareBusy(true);
    setShareError('');
    setShareSuccess('');

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      setShareError('Vous devez être connecté pour partager une note.');
      setShareBusy(false);
      return;
    }

    if (recipientId === user.id) {
      setShareError('Vous ne pouvez pas partager la note avec votre propre compte.');
      setShareBusy(false);
      return;
    }

    const { error } = await supabase
      .from('note_shares')
      .upsert({
        note_id: note.id,
        recipient_id: recipientId,
        permission,
        status: 'pending',
        accepted_at: null,
      }, { onConflict: 'note_id,recipient_id' });

    if (error) {
      console.error('Erreur de partage :', error);
      setShareError(`Le partage n'a pas pu être enregistré : ${error.message}`);
    } else {
      const recipient = shareProfiles.find((profile) => profile.id === recipientId);
      setShareSuccess(`Invitation envoyée à ${recipient?.display_name || 'cet utilisateur'}.`);
      setShareRecipientId(recipientId);
    }

    setShareBusy(false);
  };

  const note        = notes.find((n) => n.id === selectedId);

  // Quand on change de note, on revient toujours sur sa première slide.
  useEffect(() => {
    setActiveCardIndex(0);
  }, [selectedId]);
  const getCards = (currentNote) => {
    if (!currentNote) return [];
    const rawCards = Array.isArray(currentNote.cards) && currentNote.cards.length
      ? currentNote.cards
      : [{ id: currentNote.id, subtitle: currentNote.title || 'Untitled', text: currentNote.text || '' }];
    return rawCards.map((rawCard, index) => ({
      ...rawCard,
      subtitle: rawCard.subtitle ?? (index === 0 ? currentNote.title : 'Untitled'),
      text: rawCard.text ?? (index === 0 ? currentNote.text : ''),
      format: rawCard.format ?? (index === 0 ? currentNote.format : DEFAULT_TEXT_FORMAT),
      color: rawCard.color ?? (index === 0 ? currentNote.color : 'Yellow'),
      images: rawCard.images ?? (index === 0 ? currentNote.images : []),
      links: rawCard.links ?? (index === 0 ? currentNote.links : []),
      tables: rawCard.tables ?? (index === 0 ? currentNote.tables : []),
      isLocked: rawCard.isLocked ?? (index === 0 ? currentNote.isLocked : false),
      lockPasswordHash: rawCard.lockPasswordHash ?? (index === 0 ? currentNote.lockPasswordHash : undefined),
      lockPasswordSalt: rawCard.lockPasswordSalt ?? (index === 0 ? currentNote.lockPasswordSalt : undefined),
    }));
  };

  const cards = note ? getCards(note) : [];
  const activeCard = cards[activeCardIndex] || cards[0] || null;
  const activePal = activeCard ? (COLOR_PALETTES[activeCard.color || note?.color] || COLOR_PALETTES['Yellow']) : COLOR_PALETTES['Yellow'];
  const additionalCards = cards.slice(1);
  const currentMainText = activeCard?.text ?? '';
  const firstMainLine = currentMainText.split('\n')[0] || '';
  const detectedListType = Object.entries(LIST_PREFIXES).find(([type, prefix]) => (
    type === 'num' ? /^\d+\.\s/.test(firstMainLine) : firstMainLine.startsWith(prefix)
  ))?.[0] || null;
  const listStateKey = `${selectedId}:${activeCardIndex}`;
  const activeListType = Object.prototype.hasOwnProperty.call(listTypesByCard, listStateKey)
    ? listTypesByCard[listStateKey]
    : detectedListType;
  const setActiveListType = (value) => {
    setListTypesByCard((previousTypes) => ({ ...previousTypes, [listStateKey]: value }));
  };

  const updateCardAt = (cardIndex, patch) => {
    if (!note) return;
    setNotes((prev) => prev.map((currentNote) => {
      if (currentNote.id !== selectedId) return currentNote;
      const currentCards = getCards(currentNote);
      const index = Math.max(0, Math.min(cardIndex, Math.max(0, currentCards.length - 1)));
      const nextCards = [...currentCards];
      nextCards[index] = { ...nextCards[index], ...patch };
      const updated = { ...currentNote, cards: nextCards };
      if (index === 0) {
        Object.assign(updated, {
          title: nextCards[0].subtitle,
          text: nextCards[0].text,
          format: nextCards[0].format,
          color: nextCards[0].color,
          images: nextCards[0].images,
          links: nextCards[0].links,
          tables: nextCards[0].tables,
          isLocked: nextCards[0].isLocked,
          lockPasswordHash: nextCards[0].lockPasswordHash,
          lockPasswordSalt: nextCards[0].lockPasswordSalt,
        });
      }
      return updated;
    }));
  };

  const updateActiveCard = (patch) => updateCardAt(activeCardIndex, patch);


  // ── Taille adaptative des cartes ─────────────────────────────────────────
  const totalCards = note && note.cards ? note.cards.length : 1;
  const CARD_WIDTH =
    totalCards === 1 ? '460px' :
    totalCards === 2 ? '340px' :
    totalCards <= 4  ? '260px' : '220px';
  const CARD_MIN_HEIGHT =
    totalCards === 1 ? '380px' :
    totalCards === 2 ? '320px' :
    totalCards <= 4  ? '230px' : '200px';

  const toggle   = (name) => setOpenDD((prev) => (prev === name ? null : name));
  const closeAll = () => { setOpenDD(null); setSearchOpen(false); setTableCtxMenu(null); };

  const setColor = (colorName) => { updateActiveCard({ color: colorName }); closeAll(); };

  // ── Modal renommage ───────────────────────────────────────────────────────
  const openRenameModal = () => {
    if (!note) return;
    setTempTitle(activeCard?.subtitle || note.title || '');
    setIsRenameModalOpen(true);
  };

  const saveGroupTitle = () => {
    updateActiveCard({ subtitle: tempTitle || 'Untitled' });
    setIsRenameModalOpen(false);
  };

  // ── Liste ─────────────────────────────────────────────────────────────────
  const updateMainText = (value) => {
    updateActiveCard({ text: value });
  };

  const mainTextFormat = {
    ...DEFAULT_TEXT_FORMAT,
    ...(activeCard?.format || {}),
  };

  const updateMainTextFormat = (patch) => {
    updateActiveCard({
      format: {
        ...DEFAULT_TEXT_FORMAT,
        ...(activeCard?.format || {}),
        ...patch,
      },
    });
  };

  const setTextStyle = (styleName) => {
    if (styleName === 'monospace') {
      updateMainTextFormat({ style: styleName, fontFamily: '"Courier New", monospace' });
      return;
    }
    updateMainTextFormat({ style: styleName });
  };

  const disableList = () => {
    if (!note) return;
    const currentText = activeCard?.text ?? '';
    const textarea = mainTextareaRef.current;
    const selStart = textarea ? textarea.selectionStart : 0;
    const selEnd = textarea ? textarea.selectionEnd : 0;
    const [startLine, endLine] = getSelectedLineRange(currentText, selStart, selEnd);
    const lines = currentText.split('\n');
    const newLines = lines.map((line, idx) => (
      idx >= startLine && idx <= endLine ? line.replace(LIST_PREFIX_PATTERN, '') : line
    ));
    updateMainText(newLines.join('\n'));
    if (startLine === 0 && endLine >= lines.length - 1) setActiveListType(null);
    closeAll();
  };

  const insertList = (type) => {
    if (!note) return;
    if (type === 'none') {
      disableList();
      return;
    }

    const currentText = activeCard?.text ?? '';
    const textarea = mainTextareaRef.current;
    const selStart = textarea ? textarea.selectionStart : 0;
    const selEnd = textarea ? textarea.selectionEnd : currentText.length;
    const [startLine, endLine] = getSelectedLineRange(currentText, selStart, selEnd);
    const prefix = LIST_PREFIXES[type];
    const lines = currentText.split('\n');
    let counter = 1;
    const newLines = lines.map((line, idx) => {
      if (idx < startLine || idx > endLine) return line;
      const stripped = line.replace(LIST_PREFIX_PATTERN, '');
      const formatted = type === 'num' ? `${counter}. ${stripped}` : `${prefix}${stripped}`;
      counter += 1;
      return formatted;
    });

    updateMainText(newLines.join('\n'));
    setActiveListType(type);
    closeAll();
  };

  const handleListKeyDown = (event) => {
    if (!activeListType) return;
    const textarea = event.currentTarget;
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const currentText = textarea.value;

    if (event.key === 'Enter') {
      event.preventDefault();
      const beforeCursor = currentText.slice(0, selectionStart);
      const afterCursor = currentText.slice(selectionEnd);
      const beforeLines = beforeCursor.split('\n');
      const currentLine = beforeLines[beforeLines.length - 1];
      const prefixMatch = currentLine.match(LIST_PREFIX_PATTERN);
      const lineWithoutPrefix = currentLine.replace(LIST_PREFIX_PATTERN, '');

      // Comportement Word : Entrée sur une puce vide sort de la liste
      // (seule cette ligne perd sa puce, les autres restent inchangées).
      if (prefixMatch && lineWithoutPrefix.trim() === '') {
        const linesBeforeWithoutLast = beforeLines.slice(0, -1);
        const newBeforeCursor = [...linesBeforeWithoutLast, ''].join('\n');
        updateMainText(newBeforeCursor + afterCursor);
        setActiveListType(null);
        const newCursorPosition = newBeforeCursor.length;
        requestAnimationFrame(() => textarea.setSelectionRange(newCursorPosition, newCursorPosition));
        return;
      }

      const nextNumber = beforeLines.length + 1;
      const nextPrefix = activeListType === 'num' ? `${nextNumber}. ` : LIST_PREFIXES[activeListType];
      const newText = `${beforeCursor}\n${nextPrefix}${afterCursor}`;
      const newCursorPosition = selectionStart + nextPrefix.length + 1;

      updateMainText(newText);
      requestAnimationFrame(() => textarea.setSelectionRange(newCursorPosition, newCursorPosition));
      return;
    }

    if (event.key === 'Backspace' && selectionStart === selectionEnd) {
      const beforeCursor = currentText.slice(0, selectionStart);
      const beforeLines = beforeCursor.split('\n');
      const currentLine = beforeLines[beforeLines.length - 1];
      const prefixMatch = currentLine.match(LIST_PREFIX_PATTERN);

      // Retour arrière juste après une puce : retire uniquement cette puce,
      // sans toucher aux autres lignes (comportement Word).
      if (prefixMatch && currentLine === prefixMatch[0]) {
        event.preventDefault();
        const afterCursor = currentText.slice(selectionStart);
        const linesBeforeWithoutLast = beforeLines.slice(0, -1);
        const newBeforeCursor = [...linesBeforeWithoutLast, ''].join('\n');
        updateMainText(newBeforeCursor + afterCursor);
        const newCursorPosition = newBeforeCursor.length;
        requestAnimationFrame(() => textarea.setSelectionRange(newCursorPosition, newCursorPosition));
      }
    }
  };

  // ── Tableau ───────────────────────────────────────────────────────────────
  const insertTable = (rows, cols) => {
    if (!note) return;
    const newTable = { id: crypto.randomUUID(), rows, cols, data: Array.from({ length: rows }, () => Array(cols).fill('')) };
    updateActiveCard({ tables: [...(activeCard?.tables || []), newTable] });
    closeAll();
  };

  // Modifie les tableaux de la carte visée (et pas seulement de la note),
  // car l'affichage lit card.tables.
  const updateTablesAt = (cardIndex, transform) => {
    if (!note) return;
    const targetCard = getCards(note)[cardIndex];
    if (!targetCard) return;
    updateCardAt(cardIndex, { tables: transform(targetCard.tables || []) });
  };

  const updateCell = (tableId, r, c, value, cardIndex = activeCardIndex) => {
    updateTablesAt(cardIndex, (tables) => tables.map((t) => (
      t.id !== tableId ? t : {
        ...t,
        data: t.data.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? value : cell)) : row)),
      }
    )));
  };

  const tableAddColBefore = (tableId, colIdx, cardIndex = activeCardIndex) => {
    updateTablesAt(cardIndex, (tables) => tables.map((t) => (
      t.id !== tableId ? t : {
        ...t,
        cols: t.cols + 1,
        data: t.data.map((row) => [...row.slice(0, colIdx), '', ...row.slice(colIdx)]),
      }
    )));
    setTableCtxMenu(null);
  };

  const tableAddColAfter = (tableId, colIdx, cardIndex = activeCardIndex) => {
    updateTablesAt(cardIndex, (tables) => tables.map((t) => (
      t.id !== tableId ? t : {
        ...t,
        cols: t.cols + 1,
        data: t.data.map((row) => [...row.slice(0, colIdx + 1), '', ...row.slice(colIdx + 1)]),
      }
    )));
    setTableCtxMenu(null);
  };

  const tableDeleteCol = (tableId, colIdx, cardIndex = activeCardIndex) => {
    updateTablesAt(cardIndex, (tables) => tables.map((t) => (
      (t.id !== tableId || t.cols <= 1) ? t : {
        ...t,
        cols: t.cols - 1,
        data: t.data.map((row) => row.filter((_, ci) => ci !== colIdx)),
      }
    )));
    setTableCtxMenu(null);
  };

  const tableAddRowBefore = (tableId, rowIdx, cardIndex = activeCardIndex) => {
    updateTablesAt(cardIndex, (tables) => tables.map((t) => (
      t.id !== tableId ? t : {
        ...t,
        rows: t.rows + 1,
        data: [...t.data.slice(0, rowIdx), Array(t.cols).fill(''), ...t.data.slice(rowIdx)],
      }
    )));
    setTableCtxMenu(null);
  };

  const tableAddRowAfter = (tableId, rowIdx, cardIndex = activeCardIndex) => {
    updateTablesAt(cardIndex, (tables) => tables.map((t) => (
      t.id !== tableId ? t : {
        ...t,
        rows: t.rows + 1,
        data: [...t.data.slice(0, rowIdx + 1), Array(t.cols).fill(''), ...t.data.slice(rowIdx + 1)],
      }
    )));
    setTableCtxMenu(null);
  };

  const tableDeleteRow = (tableId, rowIdx, cardIndex = activeCardIndex) => {
    updateTablesAt(cardIndex, (tables) => tables.map((t) => (
      (t.id !== tableId || t.rows <= 1) ? t : {
        ...t,
        rows: t.rows - 1,
        data: t.data.filter((_, index) => index !== rowIdx),
      }
    )));
    setTableCtxMenu(null);
  };

  // Supprime le tableau entier de la carte visée.
  const tableDelete = (tableId, cardIndex = activeCardIndex) => {
    updateTablesAt(cardIndex, (tables) => tables.filter((t) => t.id !== tableId));
    setTableCtxMenu(null);
  };

  // ── Media ─────────────────────────────────────────────────────────────────
  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (!isImage && !isVideo) {
      window.alert('Veuillez sélectionner une image ou une vidéo.');
      event.target.value = '';
      return;
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      window.alert('Vous devez être connecté pour ajouter un média.');
      event.target.value = '';
      return;
    }

    const assetId = crypto.randomUUID();
    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const mediaPath = `${user.id}/${assetId}-${safeFileName}`;
    const { error: uploadError } = await supabase.storage
      .from('note-images')
      .upload(mediaPath, file, { contentType: file.type, cacheControl: '3600', upsert: false });

    if (uploadError) {
      window.alert(`Le média n'a pas pu être envoyé : ${uploadError.message}`);
      event.target.value = '';
      return;
    }

    const { data: insertedAsset, error: insertError } = await supabase
      .from('media_assets')
      .insert({ id: assetId, user_id: user.id, name: file.name, path: mediaPath, mime_type: file.type, size: file.size })
      .select()
      .single();

    if (insertError) {
      await supabase.storage.from('note-images').remove([mediaPath]);
      window.alert(`Le média n'a pas pu être enregistré : ${insertError.message}`);
      event.target.value = '';
      return;
    }

    const { data: signedData, error: signedError } = await supabase.storage
      .from('note-images')
      .createSignedUrl(mediaPath, 3600);
    if (signedError) {
      window.alert("Le média a été envoyé, mais il ne peut pas être affiché.");
      event.target.value = '';
      return;
    }

    const newAsset = { ...insertedAsset, src: signedData.signedUrl };
    setMediaAssets((previousAssets) => [newAsset, ...previousAssets]);
    setSelectedImg(newAsset);
    setMediaTab(isVideo ? 'videos' : 'photos');
    setMediaModal(true);
    setOpenDD(null);
    event.target.value = '';
  };

  const insertSelectedImg = () => {
    if (!selectedImg || !note) return;
    const media = {
      id: crypto.randomUUID(),
      assetId: selectedImg.id,
      name: selectedImg.name,
      path: selectedImg.path,
      mime_type: selectedImg.mime_type,
      src: selectedImg.src,
    };
    updateActiveCard({ images: [...(activeCard?.images || []), media] });
    setMediaModal(false);
    setSelectedImg(null);
  };

  // ── Lien ──────────────────────────────────────────────────────────────────
  const normalizeUrl = (value) => {
    const trimmedValue = value.trim();
    if (!trimmedValue) return null;

    try {
      const url = new URL(
        /^https?:\/\//i.test(trimmedValue) ? trimmedValue : `https://${trimmedValue}`
      );
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      return url.toString();
    } catch {
      return null;
    }
  };

  const getYoutubeId = (url) => {
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.hostname.includes('youtu.be')) {
        return parsedUrl.pathname.split('/').filter(Boolean)[0] || null;
      }
      if (parsedUrl.hostname.includes('youtube.com')) {
        return parsedUrl.searchParams.get('v')
          || parsedUrl.pathname.match(/\/(?:shorts|embed)\/([^/?]+)/)?.[1]
          || null;
      }
    } catch {
      return null;
    }
    return null;
  };

  const insertLink = (link) => {
    if (!note) return;
    const normalizedUrl = normalizeUrl(link.url);
    if (!normalizedUrl) {
      setLinkError('Veuillez saisir une adresse valide.');
      return;
    }

    const linkAlreadyExists = (activeCard?.links || []).some(
      (existingLink) => normalizeUrl(existingLink.url) === normalizedUrl
    );
    if (linkAlreadyExists) {
      setLinkError('Ce lien est déjà présent dans cette note.');
      return;
    }

    // Le lien doit être enregistré sur la slide actuellement sélectionnée,
    // exactement comme les images, tableaux, couleurs et autres éléments.
    updateActiveCard({
      links: [
        ...(activeCard?.links || []),
        { ...link, id: crypto.randomUUID(), url: normalizedUrl },
      ],
    });
    setLinkError('');
    setLinkInput('');
    closeAll();
  };

  const insertCustomLink = () => {
    if (!note) return;
    const normalizedUrl = normalizeUrl(linkInput);
    if (!normalizedUrl) {
      setLinkError('Veuillez saisir une adresse valide, par exemple https://example.com.');
      return;
    }

    const youtubeId = getYoutubeId(normalizedUrl);
    const parsedUrl = new URL(normalizedUrl);
    insertLink({
      title: parsedUrl.hostname,
      source: 'Manuel',
      url: normalizedUrl,
      type: youtubeId ? 'youtube' : 'web',
      thumbnail: youtubeId ? `https://img.youtube.com/vi/${youtubeId}/mqdefault.jpg` : null,
      siteName: parsedUrl.hostname.replace(/^www\./, ''),
      description: normalizedUrl,
    });
  };

  // ── Cartes groupe ─────────────────────────────────────────────────────────
  const addGroupCard = () => {
    setNotes((prev) => prev.map((n) => {
      if (n.id !== selectedId) return n;
      const currentCards = getCards(n);
      const inheritedColor = currentCards[activeCardIndex]?.color || currentCards[0]?.color || n.color || 'Yellow';
      const inheritedFormat = { ...(currentCards[activeCardIndex]?.format || DEFAULT_TEXT_FORMAT) };
      return {
        ...n,
        cards: [...currentCards, {
          id: crypto.randomUUID(),
          subtitle: 'Untitled',
          text: '',
          format: inheritedFormat,
          color: inheritedColor,
          images: [],
          links: [],
          tables: [],
          isLocked: false,
        }],
      };
    }));
  };

  const removeLastGroupCard = () => {
    setNotes((prev) => prev.map((n) => {
      if (n.id !== selectedId) return n;
      const currentCards = getCards(n);
      if (currentCards.length <= 1) return n;
      const nextCards = currentCards.slice(0, -1);
      return { ...n, cards: nextCards };
    }));
    setActiveCardIndex((index) => Math.max(0, index - 1));
  };

  // ── Lock ──────────────────────────────────────────────────────────────────
  const handleLockToggleAction = () => {
    setPassword('');
    setLockError('');
    setShowLockPassword(false);

    if (activeCard?.isLocked) {
      setLockMode('unlock');
      setLockStep('password-input');
    } else if (activeCard?.lockPasswordHash && activeCard?.lockPasswordSalt) {
      updateActiveCard({ isLocked: true });
      setLockStep(null);
    } else {
      setLockStep('options');
    }
    setOpenDD(null);
  };

  const handleLockNote = async () => {
    if (!note || !activeCard || lockBusy) return;
    if (password.length < 6) {
      setLockError('Le mot de passe doit contenir au moins 6 caractères.');
      return;
    }
    setLockBusy(true);
    setLockError('');
    try {
      if (activeCard.isLocked || lockMode === 'unlock') {
        if (!activeCard.lockPasswordHash || !activeCard.lockPasswordSalt) {
          setLockError('Cette slide ne possède pas encore de mot de passe sécurisé.');
          return;
        }
        const candidateHash = await derivePasswordHash(password, activeCard.lockPasswordSalt);
        if (!hashesMatch(candidateHash, activeCard.lockPasswordHash)) {
          setLockError('Mot de passe incorrect.');
          return;
        }
        updateActiveCard({ isLocked: false });
      } else {
        if (lockMode === 'session') {
          const { data: userData, error: userError } = await supabase.auth.getUser();
          const email = userData?.user?.email;
          if (userError || !email) {
            setLockError('Impossible de vérifier votre session.');
            return;
          }
          const { error: sessionPasswordError } = await supabase.auth.signInWithPassword({ email, password });
          if (sessionPasswordError) {
            setLockError('Le mot de passe de session est incorrect.');
            return;
          }
        }
        const salt = createPasswordSalt();
        const passwordHash = await derivePasswordHash(password, salt);
        updateActiveCard({ isLocked: true, lockPasswordHash: passwordHash, lockPasswordSalt: salt });
      }
      setLockStep(null);
      setPassword('');
      setShowLockPassword(false);
      closeAll();
    } catch (error) {
      console.error('Erreur pendant le verrouillage :', error);
      setLockError('Une erreur est survenue. Veuillez réessayer.');
    } finally {
      setLockBusy(false);
    }
  };

  const handleCloseAllLockedNotes = () => {
    setNotes((previousNotes) => previousNotes.map((currentNote) => {
      const currentCards = getCards(currentNote);
      const lockedCards = currentCards.map((card) => (
        card.lockPasswordHash && card.lockPasswordSalt ? { ...card, isLocked: true } : card
      ));
      const updated = { ...currentNote, cards: lockedCards };
      if (lockedCards[0]) {
        Object.assign(updated, {
          isLocked: lockedCards[0].isLocked,
          lockPasswordHash: lockedCards[0].lockPasswordHash,
          lockPasswordSalt: lockedCards[0].lockPasswordSalt,
        });
      }
      return updated;
    }));
    closeAll();
  };

  // ── Coin plié ─────────────────────────────────────────────────────────────
  const FoldedCorner = () => (
    <div style={{
      position: 'absolute', bottom: 0, right: 0,
      width: '34px', height: '34px', pointerEvents: 'none',
      background: 'linear-gradient(135deg, #e4e4e4 20%, #cccccc 44%, #ffffff 52%, #ffffff 100%)',
      borderBottomRightRadius: '2px',
      boxShadow: '-3px -3px 5px rgba(0,0,0,0.18)',
    }} />
  );

  const buildMailtoUrl = (currentNote) => {
    if (!currentNote) return '#';

    const noteCards = getCards(currentNote);
    const body = noteCards
      .map((card) => {
        const title = card.subtitle || 'Untitled';
        const text = card.text || '';
        const tables = (card.tables || [])
          .map((table) => (table.data || []).map((row) => (row || []).join(' | ')).join('\n'))
          .filter(Boolean)
          .join('\n\n');

        return [
          noteCards.length > 1 ? `--- ${title} ---` : '',
          text,
          tables,
        ].filter(Boolean).join('\n');
      })
      .filter(Boolean)
      .join('\n\n');

    return `mailto:?subject=${encodeURIComponent(currentNote.title || 'Note')}&body=${encodeURIComponent(body)}`;
  };

  const sendNoteByMail = (event) => {
    // Le navigateur doit effectuer lui-même la navigation mailto:
    // via un vrai <a href="mailto:...">. On ne remplace donc pas
    // window.location et on ne crée pas de lien caché en JavaScript.
    if (!note) {
      event?.preventDefault();
      return;
    }
    closeAll();
  };

  // ── Rendu des tableaux d'une slide ───────────────────────────────────────
  const renderCardTables = (card, globalIdx) => {
    const pal = COLOR_PALETTES[card?.color] || COLOR_PALETTES['Yellow'];
    return (card?.tables || []).map((tbl) => (
      <div key={tbl.id} className="note-table-wrapper" style={{ position: 'relative', margin: '4px 0 12px', padding: '20px 0 0 20px', flexShrink: 0 }}>
        {Array.from({ length: tbl.cols }).map((_, ci) => {
          const isActive = tableCtxMenu?.tableId === tbl.id && tableCtxMenu?.type === 'column' && tableCtxMenu?.index === ci && tableCtxMenu?.cardIndex === globalIdx;
          return (
            <button key={`column-${ci}`} type="button" className="col-handle" aria-label={`Options de la colonne ${ci + 1}`}
              onClick={(e) => { e.stopPropagation(); setTableCtxMenu({ tableId: tbl.id, type: 'column', index: ci, cardIndex: globalIdx }); }}
              style={{ position: 'absolute', top: 0, left: `calc(20px + ${(ci / tbl.cols) * 100}% - ${(ci / tbl.cols) * 20}px)`, width: `calc(${100 / tbl.cols}% - ${20 / tbl.cols}px)`, height: '20px', padding: 0, border: 'none', borderRadius: '5px 5px 0 0', background: isActive ? '#ffb800' : 'transparent', color: isActive ? '#fff' : '#b8b8b8', cursor: 'pointer', fontSize: '15px', lineHeight: 1 }}>
              •••
            </button>
          );
        })}
        {Array.from({ length: tbl.rows }).map((_, ri) => {
          const isActive = tableCtxMenu?.tableId === tbl.id && tableCtxMenu?.type === 'row' && tableCtxMenu?.index === ri && tableCtxMenu?.cardIndex === globalIdx;
          return (
            <button key={`row-${ri}`} type="button" className="row-handle" aria-label={`Options de la ligne ${ri + 1}`}
              onClick={(e) => { e.stopPropagation(); setTableCtxMenu({ tableId: tbl.id, type: 'row', index: ri, cardIndex: globalIdx }); }}
              style={{ position: 'absolute', left: 0, top: `calc(20px + ${(ri / tbl.rows) * 100}% - ${(ri / tbl.rows) * 20}px)`, width: '20px', height: `calc(${100 / tbl.rows}% - ${20 / tbl.rows}px)`, padding: 0, border: 'none', borderRadius: '5px 0 0 5px', background: isActive ? '#ffb800' : 'transparent', color: isActive ? '#fff' : '#b8b8b8', cursor: 'pointer', fontSize: '14px', lineHeight: 0.55, writingMode: 'vertical-rl' }}>
              •••
            </button>
          );
        })}
        <table className="note-table" style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
          <tbody>
            {tbl.data.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci} style={{ border: '1px solid #a9a9a9', padding: '2px', height: '54px' }}>
                    <input value={cell} onChange={(e) => updateCell(tbl.id, ri, ci, e.target.value, globalIdx)} onFocus={() => { setActiveCardIndex(globalIdx); setTableCtxMenu(null); }}
                      style={{ width: '100%', height: '100%', border: 'none', background: 'transparent', outline: 'none', fontSize: '13px', padding: '7px', color: pal.darkText, boxSizing: 'border-box' }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {tableCtxMenu?.tableId === tbl.id && tableCtxMenu?.cardIndex === globalIdx && (
          <div className="table-ctx-menu" onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', zIndex: 999, minWidth: '170px', overflow: 'hidden', top: tableCtxMenu.type === 'column' ? '20px' : `calc(20px + ${(tableCtxMenu.index / tbl.rows) * 100}%)`, ...(tableCtxMenu.type === 'row' ? { left: '24px' } : (tableCtxMenu.index >= tbl.cols / 2 ? { right: 0 } : { left: `calc(20px + ${(tableCtxMenu.index / tbl.cols) * 100}%)` })), background: 'rgba(238,238,238,0.98)', border: '1px solid #dedede', borderRadius: '8px', boxShadow: '0 5px 18px rgba(0,0,0,.18)' }}>
            {(tableCtxMenu.type === 'column' ? [
              { label: 'Insert a front column', action: () => tableAddColBefore(tbl.id, tableCtxMenu.index, tableCtxMenu.cardIndex) },
              { label: 'Insert column after', action: () => tableAddColAfter(tbl.id, tableCtxMenu.index, tableCtxMenu.cardIndex) },
              { label: 'Delete column', action: () => tableDeleteCol(tbl.id, tableCtxMenu.index, tableCtxMenu.cardIndex), destructive: true },
              { label: 'Delete table', action: () => tableDelete(tbl.id, tableCtxMenu.cardIndex), destructive: true },
            ] : [
              { label: 'Insert a row above', action: () => tableAddRowBefore(tbl.id, tableCtxMenu.index, tableCtxMenu.cardIndex) },
              { label: 'Insert a row below', action: () => tableAddRowAfter(tbl.id, tableCtxMenu.index, tableCtxMenu.cardIndex) },
              { label: 'Delete row', action: () => tableDeleteRow(tbl.id, tableCtxMenu.index, tableCtxMenu.cardIndex), destructive: true },
              { label: 'Delete table', action: () => tableDelete(tbl.id, tableCtxMenu.cardIndex), destructive: true },
            ]).map(({ label, action, destructive }) => (
              <button key={label} onClick={action} style={{ display: 'block', width: '100%', padding: '9px 14px', textAlign: 'left', background: 'none', border: 'none', borderTop: destructive ? '1px solid #c9c9c9' : 'none', cursor: 'pointer', fontSize: '13px', color: '#111' }}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    ));
  };

  // ── Rendu d'une slide ─────────────────────────────────────────────────────
  const renderCardBody = (card, globalIdx, { isMain = false } = {}) => {
    if (!card) return null;
    const pal = COLOR_PALETTES[card.color] || COLOR_PALETTES['Yellow'];
    const format = { ...DEFAULT_TEXT_FORMAT, ...(card.format || {}) };
    const text = card.text || '';
    const images = card.images || [];
    const links = card.links || [];
    const isLocked = !!card.isLocked;
    return (
      <div className="sticky-body sticky-body-scroll" style={{ padding: '18px 20px', flex: 1, display: 'flex', flexDirection: 'column', ...SCROLLABLE_BODY_STYLE }}>
        {isLocked ? (
          <div className="lock-masked-screen">
            <i className="fa-solid fa-lock lock-masked-icon"></i>
            <p className="lock-masked-text">Cette slide est protégée.</p>
            <button className="btn-lock-yellow" style={{ width: 'auto', padding: '8px 20px', marginTop: '10px' }} onClick={(e) => { e.stopPropagation(); setActiveCardIndex(globalIdx); setLockMode('unlock'); setPassword(''); setLockError(''); setLockStep('password-input'); }}>
              Saisir le mot de passe
            </button>
          </div>
        ) : (
          <>
            {images.map((media) => (
              <div key={media.id} className="note-image-block" style={{ flexShrink: 0, flexGrow: 0, width: '100%', position: 'relative', marginBottom: '10px' }}>
                {media.mime_type?.startsWith('video/') ? (
                  <video src={media.src} controls playsInline preload="metadata" style={{ width: '100%', height: isMain ? '260px' : '180px', maxHeight: isMain ? '260px' : '180px', objectFit: 'contain', borderRadius: '6px', display: 'block' }} />
                ) : (
                  <img src={media.src} alt={media.name} style={{ width: '100%', height: isMain ? '260px' : '180px', maxHeight: isMain ? '260px' : '180px', objectFit: 'contain', borderRadius: '6px', display: 'block' }} />
                )}
                <button className="note-image-remove" onClick={(e) => { e.stopPropagation(); updateCardAt(globalIdx, { images: (card.images || []).filter((i) => i.id !== media.id) }); }}>✕</button>
              </div>
            ))}
            {links.map((lnk) => (
              <div key={lnk.id} className="link-preview-card" style={{ flexShrink: 0 }}>
                {lnk.thumbnail && <div className="link-preview-thumb"><img src={lnk.thumbnail} alt={lnk.title} />{lnk.type === 'youtube' && <div className="link-preview-play"><i className="fa-solid fa-play"></i></div>}</div>}
                <div className="link-preview-info">
                  <a href={normalizeUrl(lnk.url) || '#'} target="_blank" rel="noopener noreferrer" title="Ouvrir le lien dans un nouvel onglet" style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}>
                    <div className="link-preview-desc">{lnk.description}</div><div className="link-preview-site">{lnk.siteName}</div>
                  </a>
                </div>
                <div className="link-preview-bar" style={{ background: pal.header }} />
                <button className="link-preview-remove" onClick={(e) => { e.stopPropagation(); updateCardAt(globalIdx, { links: (card.links || []).filter((l) => l.id !== lnk.id) }); }}>✕</button>
              </div>
            ))}
            <textarea value={text} placeholder="Start a note..." style={{ color: format.color || pal.darkText, width: '100%', minHeight: (card.tables || []).length > 0 ? '80px' : '120px', flex: '0 0 auto', overflow: 'hidden', background: format.backgroundColor || 'transparent', border: 'none', borderLeft: format.style === 'quote' ? '3px solid #ff9500' : 'none', outline: 'none', resize: 'none', paddingLeft: format.style === 'quote' ? '12px' : '0', fontSize: `${format.fontSize}px`, lineHeight: 1.6, fontFamily: format.fontFamily, fontWeight: format.bold ? '700' : '400', fontStyle: format.italic ? 'italic' : 'normal', textDecoration: [format.underline ? 'underline' : '', format.strike ? 'line-through' : ''].filter(Boolean).join(' ') || 'none', textAlign: format.align }}
              onFocus={() => setActiveCardIndex(globalIdx)}
              onChange={(e) => { setActiveCardIndex(globalIdx); updateActiveCard({ text: e.target.value }); }}
              onInput={(e) => { e.target.style.height = 'auto'; e.target.style.height = `${e.target.scrollHeight}px`; }}
              ref={(el) => { if (el && globalIdx === activeCardIndex) { mainTextareaRef.current = el; el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } }}
              onKeyDown={handleListKeyDown}
            />
            {renderCardTables(card, globalIdx)}
          </>
        )}
      </div>
    );
  };

  const renderMainStickyNote = () => {
    if (!note || !cards[0]) return null;
    const card = cards[0];
    const pal = COLOR_PALETTES[card.color] || COLOR_PALETTES['Yellow'];
    return (
      <div className="sticky-note" onClick={() => setActiveCardIndex(0)} style={{ background: pal.body, width: CARD_WIDTH, height: CARD_MIN_HEIGHT, maxHeight: CARD_MIN_HEIGHT, flex: '0 0 auto', position: 'relative', borderRadius: '6px', boxShadow: 'none', display: 'flex', flexDirection: 'column', overflow: 'hidden', clipPath: 'none', outline: 'none' }}>
        <div className="sticky-header-bar" style={{ background: pal.header, color: pal.text, fontWeight: 800, fontSize: '20px', padding: '22px 20px', textAlign: 'center', borderBottom: '2px solid rgba(0,0,0,0.12)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: '0 0 auto' }}>{card.isLocked ? '🔒 Contenu Protégé' : (card.subtitle || 'Untitled')}</div>
        {renderCardBody(card, 0, { isMain: true })}
        <FoldedCorner />
      </div>
    );
  };

  const renderGroupCard = (card, subIdx) => {
    const globalIdx = subIdx + 1;
    const pal = COLOR_PALETTES[card.color] || COLOR_PALETTES['Yellow'];
    return (
      <div key={card.id} className="sticky-note" onClick={() => setActiveCardIndex(globalIdx)} style={{ background: pal.body, width: CARD_WIDTH, height: CARD_MIN_HEIGHT, maxHeight: CARD_MIN_HEIGHT, flex: '0 0 auto', position: 'relative', borderRadius: '6px', boxShadow: 'none', display: 'flex', flexDirection: 'column', overflow: 'hidden', outline: activeCardIndex === globalIdx ? '2px solid #007AFF' : 'none', outlineOffset: '2px' }}>
        <div className="sticky-header-bar" style={{ background: pal.header, color: pal.text, fontWeight: 800, fontSize: '20px', padding: '22px 20px', textAlign: 'center', borderBottom: '2px solid rgba(0,0,0,0.12)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: '0 0 auto' }}>{card.isLocked ? '🔒 Contenu Protégé' : (card.subtitle || 'Untitled')}</div>
        {renderCardBody(card, globalIdx)}
        <FoldedCorner />
      </div>
    );
  };

  // ══════════════════════════════════════════════════════════════════════════
  return (
    <main className="note-editor" id="note-editor"
      onClick={(e) => {
        if (!e.target.closest('.editor-toolbar') && !e.target.closest('.search-wrapper')) closeAll();
        if (!e.target.closest('.table-ctx-menu') && !e.target.closest('.col-handle') && !e.target.closest('.row-handle')) setTableCtxMenu(null);
      }}>

      {/* Styles injectés pour rendre la scrollbar visible sur Chrome / Safari / Edge
          (WebKit ne respecte pas scrollbarWidth/scrollbarColor en style inline). */}
      <style>{`
        /* !important : neutralise toute règle CSS externe (App.css, index.css…)
           qui imposerait overflow:visible ou height:auto sur ces classes. */
        .sticky-note {
          overflow: hidden !important;
        }
        .sticky-body-scroll {
          overflow-y: scroll !important;
          overflow-x: hidden !important;
        }
        .sticky-body-scroll::-webkit-scrollbar {
          width: 10px;
        }
        .sticky-body-scroll::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.06);
          border-radius: 8px;
        }
        .sticky-body-scroll::-webkit-scrollbar-thumb {
          background-color: rgba(0, 0, 0, 0.35);
          border-radius: 8px;
          border: 2px solid transparent;
          background-clip: padding-box;
        }
        .sticky-body-scroll::-webkit-scrollbar-thumb:hover {
          background-color: rgba(0, 0, 0, 0.55);
        }
      `}</style>

      {/* ═══ BARRE D'OUTILS ═══════════════════════════════════════════════
          FIX : style inline en flex-start + gap régulier de 14px pour que
          la loupe suive directement le reste des icônes au lieu d'être
          poussée tout à droite par un éventuel justify-content:space-between
          hérité du CSS global (.editor-toolbar). */}
      <div
        className="editor-toolbar"
        id="toolbar"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px', width: '100%' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-evenly', flex: 1, gap: '4px' }}>

        {/* ── COULEUR ── */}
        <div className="rel">
          <button onClick={() => toggle('color')} title="Couleur">
            <i className="fa-solid fa-droplet" style={{ color: activePal.header }}></i>
          </button>
          {openDD === 'color' && (
            <div className="colors-dropdown">
              <div className="dropdown-title">Colors suggestions</div>
              <ul className="colors-list">
                {Object.entries(COLOR_PALETTES).map(([name, pal]) => (
                  <li key={name} className="color-item" onClick={(e) => { e.stopPropagation(); setColor(name); }}>
                    <span className="color-square" style={{ background: pal.header }} />
                    <span className="color-name">{name}</span>
                    {activeCard?.color === name && <i className="fa-solid fa-check check-icon" style={{ color: '#007AFF' }}></i>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="tb-divider" />

        {/* ── Aa ── */}
        <div className="rel">
          <button onClick={(e) => { e.stopPropagation(); toggle('aa'); }} title="Police"
            style={{ background: openDD === 'aa' ? '#dcdcdc' : 'transparent', borderRadius: '5px', border: 'none', padding: '6px 12px', cursor: 'pointer' }}>
            <span style={{ fontWeight: '500', fontSize: '15px', color: '#857f7f' }}>Aa</span>
          </button>
          {openDD === 'aa' && (
            <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: '6px', background: 'rgba(235,235,235,0.97)', backdropFilter: 'blur(25px)', borderRadius: '16px', padding: '12px', boxShadow: '0 12px 35px rgba(0,0,0,0.15)', zIndex: 9999, width: '220px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 4px' }}>
                {[
                  { label: 'B', field: 'bold', active: mainTextFormat.bold, style: { fontWeight: '700' } },
                  { label: 'I', field: 'italic', active: mainTextFormat.italic, style: { fontStyle: 'italic' } },
                  { label: 'U', field: 'underline', active: mainTextFormat.underline, style: { textDecoration: 'underline' } },
                  { label: 'S', field: 'strike', active: mainTextFormat.strike, style: { textDecoration: 'line-through' } },
                ].map((control) => (
                  <button key={control.field} type="button"
                    aria-pressed={control.active}
                    onClick={() => updateMainTextFormat({ [control.field]: !control.active })}
                    style={{ background: control.active ? '#fff' : 'transparent', border: 'none', borderRadius: '5px', fontSize: '15px', color: '#000', cursor: 'pointer', width: '32px', height: '28px', ...control.style }}>
                    {control.label}
                  </button>
                ))}
              </div>
              <div style={{ height: '1px', background: 'rgba(0,0,0,0.06)' }} />
              {[
                { value: 'body', label: 'Body' },
                { value: 'monospace', label: 'Monostyle' },
                { value: 'quote', label: 'Quote block' },
              ].map((textStyle) => (
                <button key={textStyle.value} type="button" onClick={() => setTextStyle(textStyle.value)}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', fontSize: '12px', padding: '5px 6px', border: 'none', borderRadius: '5px', background: mainTextFormat.style === textStyle.value ? '#fff' : 'transparent', cursor: 'pointer', textAlign: 'left' }}>
                  <span style={{ width: '12px', color: '#007aff' }}>{mainTextFormat.style === textStyle.value ? '✓' : ''}</span>
                  {textStyle.value === 'quote' && <span style={{ width: '3px', height: '14px', background: '#ff9500', borderRadius: '1px' }} />}
                  <span style={{ fontFamily: textStyle.value === 'monospace' ? '"Courier New", monospace' : 'inherit' }}>{textStyle.label}</span>
                </button>
              ))}
              <div style={{ position: 'relative' }}>
                <select value={mainTextFormat.fontFamily} onChange={(e) => updateMainTextFormat({ fontFamily: e.target.value })}
                  style={{ width: '100%', height: '28px', background: '#fff', border: '1px solid rgba(0,0,0,0.12)', borderRadius: '6px', fontSize: '12px', padding: '0 24px 0 8px', outline: 'none', cursor: 'pointer' }}>
                  {FONT_OPTIONS.map((font) => <option key={font.label} value={font.value}>{font.label}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <div style={{ position: 'relative', width: '62px' }}>
                  <select value={mainTextFormat.fontSize} onChange={(e) => updateMainTextFormat({ fontSize: Number(e.target.value) })}
                    style={{ width: '100%', height: '28px', background: '#fff', border: '1px solid rgba(0,0,0,0.12)', borderRadius: '6px', fontSize: '12px', paddingLeft: '6px', outline: 'none' }}>
                    {[8, 10, 12, 14, 15, 16, 18, 20, 24, 28, 32].map((size) => <option key={size} value={size}>{size}</option>)}
                  </select>
                </div>
                <label title="Couleur du texte" style={{ position: 'relative', flex: 1, height: '28px', background: '#fff', border: '1px solid rgba(0,0,0,0.12)', borderRadius: '6px', display: 'flex', alignItems: 'center', padding: '0 8px', gap: '6px', cursor: 'pointer' }}>
                  <span style={{ fontSize: '11px', fontWeight: '700' }}>A</span>
                  <span style={{ width: '15px', height: '15px', background: mainTextFormat.color, borderRadius: '3px', marginLeft: 'auto', border: '1px solid #ddd' }} />
                  <input type="color" value={mainTextFormat.color} onChange={(e) => updateMainTextFormat({ color: e.target.value })} style={{ position: 'absolute', opacity: 0, inset: 0, cursor: 'pointer' }} />
                </label>
                <label title="Surlignage" style={{ position: 'relative', flex: 1, height: '28px', background: '#fff', border: '1px solid rgba(0,0,0,0.12)', borderRadius: '6px', display: 'flex', alignItems: 'center', padding: '0 8px', cursor: 'pointer' }}>
                  <i className="fa-solid fa-highlighter" style={{ fontSize: '11px' }} />
                  <span style={{ width: '15px', height: '15px', background: mainTextFormat.backgroundColor === 'transparent' ? '#fff7cc' : mainTextFormat.backgroundColor, borderRadius: '3px', marginLeft: 'auto', border: '1px solid #ddd' }} />
                  <input type="color" value={mainTextFormat.backgroundColor === 'transparent' ? '#fff7cc' : mainTextFormat.backgroundColor} onChange={(e) => updateMainTextFormat({ backgroundColor: e.target.value })} style={{ position: 'absolute', opacity: 0, inset: 0, cursor: 'pointer' }} />
                </label>
              </div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {[
                  ['left', 'fa-align-left'], ['center', 'fa-align-center'],
                  ['right', 'fa-align-right'], ['justify', 'fa-align-justify'],
                ].map(([align, icon]) => (
                  <button key={align} type="button" onClick={() => updateMainTextFormat({ align })}
                    style={{ flex: 1, height: '28px', border: 'none', borderRadius: '5px', background: mainTextFormat.align === align ? '#fff' : 'transparent', cursor: 'pointer', color: '#555' }}>
                    <i className={`fa-solid ${icon}`} />
                  </button>
                ))}
                <button type="button" title="Supprimer la mise en forme" onClick={() => updateMainTextFormat(DEFAULT_TEXT_FORMAT)}
                  style={{ width: '32px', height: '28px', border: 'none', borderRadius: '5px', background: 'transparent', cursor: 'pointer', color: '#777' }}>
                  <i className="fa-solid fa-eraser" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── LISTE ── */}
        <div className="rel">
          <button
            onClick={() => activeListType ? disableList() : toggle('list')}
            title={activeListType ? 'Désactiver la liste' : 'Créer une liste'}
            style={{ background: openDD === 'list' || activeListType ? '#dcdcdc' : 'transparent', borderRadius: '4px', border: 'none', padding: '6px 10px', cursor: 'pointer' }}>
            <i className="fa-solid fa-list-ul" style={{ fontSize: '15px', color: '#857f7f' }}></i>
          </button>
          {openDD === 'list' && (
            <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: '100%', left: '0', marginTop: '4px', background: 'rgba(238,238,238,0.)', backdropFilter: 'blur(25px)', borderRadius: '10px', padding: '15px', boxShadow: '0 10px 30px rgba(0,0,0,0.15)', zIndex: 9999, width: '230px', display: 'flex', gap: '6px' }}>
              <button onClick={() => insertList('none')} style={{ width: '42px', height: '54px', background: '#d0e1f9', border: 'none', borderRadius: '5px', color: '#0055cc', fontSize: '11px', fontWeight: '500', cursor: 'pointer' }}>None</button>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '25px', flex: 1 }}>
                {[
                  { type: 'disc', els: ['•','•','•'] }, { type: 'circle', els: ['◦','◦','◦'] },
                  { type: 'num', els: ['1.','2.','3.'] }, { type: 'check', els: ['❑','❑','❑'] },
                  { type: 'diamond', els: ['◆','◆','◆'] }, { type: 'arrow', els: ['➔','➔','➔'] },
                  { type: 'checkmark', els: ['✓','✓','✓'] },
                ].map((item, idx) => (
                  <button key={idx} onClick={() => insertList(item.type)}
                    style={{ background: 'rgba(255,255,255,0.4)', border: '1px solid rgba(0,0,0,0.04)', borderRadius: '4px', padding: '4px 2px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '3px' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.8)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.4)'}>
                    {item.els.map((bullet, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                        <span style={{ fontSize: '8px', color: '#857f7f', minWidth: '8px', textAlign: 'center' }}>{bullet}</span>
                        <div style={{ height: '1.5px', background: '#aaa', flex: 1 }} />
                      </div>
                    ))}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── TABLEAU ── */}
        <div className="rel">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (!note) return;
              // Ajoute un nouveau tableau sans supprimer les tableaux existants
              insertTable(2, 2);
            }}
            title={activeCard?.tables?.length > 0 ? 'Add another table' : 'Add a table'}
            style={{
              background: activeCard?.tables?.length > 0 ? '#dcdcdc' : 'transparent',
              borderRadius: '5px',
              border: 'none',
              padding: '6px 10px',
              cursor: 'pointer',
            }}
          >
            <svg width="18" height="14" viewBox="0 0 18 14" fill="none" aria-hidden="true">
              <rect x="0.5" y="0.5" width="17" height="13" rx="1.5" stroke="#857f7f" strokeWidth="1" />
              <line x1="9" y1="0.5" x2="9" y2="13.5" stroke="#857f7f" strokeWidth="1" />
              <line x1="0.5" y1="7" x2="17.5" y2="7" stroke="#857f7f" strokeWidth="1" />
            </svg>
          </button>
        </div>

        {/* ── IMAGE / MEDIA ── */}
        <div className="rel">
          <button
            onClick={() => toggle('media')}
            title="Open your device's photo browser"
            className={`toolbar-light-icon ${openDD === 'media' ? 'active' : ''}`}
          >
            <i className="fa-regular fa-image"></i>
          </button>
          {openDD === 'media' && (
            <div className="media-dropdown" onClick={(e) => e.stopPropagation()}>
              <button className="media-item media-item-top" onClick={() => { setMediaModal(true); setMediaTab('photos'); closeAll(); }}>Photos &amp; Videos</button>
              <div className="media-section-separator" />
              <div className="media-section-label">GhostLabs App</div>
              <button className="media-item" onClick={() => { fileInputRef.current?.click(); closeAll(); }}>Take a photo</button>
              <button className="media-item" onClick={closeAll}>Scan documents</button>
              <button className="media-item" onClick={closeAll}>Add a sketch</button>
            </div>
          )}
        </div>
        <input ref={fileInputRef} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={handleFileChange} />

        {/* ── LIEN ── */}
        <div className="rel">
          <button
            onClick={() => toggle('link')}
            title="Add a link"
            className={`toolbar-light-icon ${openDD === 'link' ? 'active' : ''}`}
          >
            <i className="fa-solid fa-link"></i>
          </button>
          {openDD === 'link' && (
            <div className="link-dropdown" onClick={(e) => e.stopPropagation()}>
              <div className="link-dropdown-title">Add a link to the app</div>
              <div className="link-suggestions">
                {LINK_SUGGESTIONS.map((s) => (
                  <div key={s.id} className="link-suggestion-row">
                    <div className="link-suggestion-left">
                      <div className="link-favicon-wrap">
                        {s.type === 'youtube' ? <i className="fa-brands fa-youtube" style={{ color: '#FF0000', fontSize: '18px' }}></i> : <i className="fa-solid fa-globe" style={{ color: '#857f7f', fontSize: '14px' }}></i>}
                      </div>
                      <div className="link-suggestion-text">
                        <div className="link-suggestion-title">{s.title}</div>
                        <div className="link-suggestion-source">{s.source}</div>
                      </div>
                    </div>
                    <button className="link-add-btn" onClick={() => insertLink(s)}>Add link</button>
                  </div>
                ))}
              </div>
              <div className="link-divider" />
              <div className="link-manual-row">
                <input type="text" className="link-manual-input" placeholder="Coller un lien..." value={linkInput}
                  onChange={(e) => { setLinkInput(e.target.value); setLinkError(''); }}
                  onKeyDown={(e) => e.key === 'Enter' && insertCustomLink()} />
                <button className="link-add-btn" onClick={insertCustomLink}>Add</button>
              </div>
              {linkError && (
                <div role="alert" style={{ color: '#d93025', fontSize: '12px', padding: '8px 12px 2px' }}>
                  {linkError}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="tb-divider" />

        {/* ── LOCK ── */}
        <div className="rel">
          <button
            onClick={() => toggle('lock')}
            title="Verrouiller"
            className={`toolbar-light-icon ${openDD === 'lock' || activeCard?.isLocked ? 'active' : ''}`}
          >
            <i className={`fa-solid ${activeCard?.isLocked ? 'fa-lock' : 'fa-lock-open'}`}></i>
          </button>
          {openDD === 'lock' && (
            <div className="lock-dropdown">
              <button className="lock-item" onClick={handleLockToggleAction}>{activeCard?.isLocked ? 'Unlock this slide' : 'Lock this slide'}</button>
              <button className="lock-item" onClick={handleCloseAllLockedNotes}>Close all locked notes</button>
            </div>
          )}
        </div>

        {/* ── PARTAGER ── */}
        <div className="rel">
          <button
            onClick={(e) => { e.stopPropagation(); openShareMenu(); }}
            title="Partager"
            className={`toolbar-light-icon ${openDD === 'share' ? 'active' : ''}`}
          >
            <i className="fa-solid fa-arrow-up-from-bracket"></i>
          </button>
          {openDD === 'share' && (
            <div className="share-dropdown" onClick={(e) => e.stopPropagation()}>
              <div className="share-header">
                <div className="note-mini-preview">
                  <div className="mini-header-blue">{note?.title || 'Untitled'}</div>
                  <div className="mini-body-lines"><div className="mini-line"></div><div className="mini-line short"></div></div>
                </div>
                <div className="share-header-text">
                  <h3>{note?.title || 'New note'}</h3>
                  <p>{note?.folder || 'Notes'}</p>
                </div>
              </div>

              <div className="share-select-container">
                <select
                  className="share-action-select"
                  value={shareMode}
                  onChange={(e) => { setShareMode(e.target.value); setShareError(''); setShareSuccess(''); }}
                >
                  <option value="copy">Send a copy</option>
                  <option value="collaborate">Collaborate</option>
                </select>
              </div>

              <div className="share-section-title">SpaceChat / GhostLabs Contacts</div>

              {shareProfilesLoading ? (
                <div style={{ padding: '12px 4px', fontSize: '12px', color: '#777', textAlign: 'center' }}>Loading contacts...</div>
              ) : shareProfiles.length === 0 ? (
                <div style={{ padding: '12px 4px', fontSize: '12px', color: '#777', textAlign: 'center' }}>No other users found.</div>
              ) : (
                <div className="share-contacts-row">
                  {shareProfiles.map((profile, profileIndex) => {
                    const displayName = profile.display_name || `User ${profileIndex + 1}`;
                    const initials = displayName
                      .split(/\s+/)
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((part) => part[0].toUpperCase())
                      .join('');
                    const isSelected = shareRecipientId === profile.id;
                    return (
                      <button
                        key={profile.id}
                        type="button"
                        className="contact-item"
                        onClick={() => {
                          if (shareMode === 'collaborate') {
                            createNoteShare(profile.id, 'editor');
                          } else {
                            setShareError('Send a copy sera branché après la duplication complète de la note.');
                          }
                        }}
                        disabled={shareBusy}
                        title={shareMode === 'collaborate' ? `Collaborer avec ${displayName}` : `Envoyer une copie à ${displayName}`}
                        style={{ border: 'none', background: 'transparent', cursor: shareBusy ? 'wait' : 'pointer', padding: 0, opacity: shareBusy && !isSelected ? 0.6 : 1 }}
                      >
                        <div
                          className="contact-avatar"
                          style={profile.avatar_url ? { backgroundImage: `url(${profile.avatar_url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
                        >
                          {profile.avatar_url ? null : initials || <i className="fa-solid fa-user"></i>}
                        </div>
                        <span>{displayName}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {shareError && (
                <div role="alert" style={{ color: '#d93025', fontSize: '12px', padding: '8px 4px 2px' }}>
                  {shareError}
                </div>
              )}

              {shareSuccess && (
                <div role="status" style={{ color: '#188038', fontSize: '12px', padding: '8px 4px 2px' }}>
                  {shareSuccess}
                </div>
              )}

              <div className="share-divider"></div>

              <a
                className="share-app-row"
                href={buildMailtoUrl(note)}
                onClick={sendNoteByMail}
                title="Envoyer une copie de la note par e-mail"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  textDecoration: 'none',
                  color: 'inherit',
                  width: '100%',
                  cursor: 'pointer',
                }}
              >
                <div className="app-icon-mail">
                  <i className="fa-solid fa-envelope"></i>
                </div>
                <span className="app-label">Mail</span>
              </a>
            </div>
          )}
        </div>

        {/* ── RECHERCHE ── */}
        {/* La recherche passe avant Verrouiller et Partager grâce à order: 1.
            Sa largeur animée pousse réellement ces deux boutons vers la droite
            sans les masquer lorsque le champ s'ouvre. */}
        <div className="search-wrapper rel" style={{
          order: 1,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          width: searchOpen ? '250px' : '36px',
          minWidth: searchOpen ? '250px' : '36px',
          marginLeft: '-4px',
          transition: 'width 0.3s ease, min-width 0.3s ease',
          flexShrink: 0,
        }}>
          <button title="Search" onClick={(e) => { e.stopPropagation(); if (searchOpen) { closeAll(); } else { closeAll(); setSearchOpen(true); } }}
            style={{
              background: 'transparent',
              border: 'none',
              padding: '6px 10px',
              cursor: 'pointer',
              borderRadius: '5px',
              opacity: searchOpen ? 0 : 1,
              visibility: searchOpen ? 'hidden' : 'visible',
              pointerEvents: searchOpen ? 'none' : 'auto',
              transition: 'opacity 0.15s ease',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.05)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            <i className="fa-solid fa-magnifying-glass" style={{ fontSize: '16px', color: '#857f7f' }}></i>
          </button>

          {searchOpen && (
            <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: '50%', left: '0', transform: 'translateY(-50%)', zIndex: 10000 }}>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input type="text" placeholder="Search" autoFocus value={mediaSearch} onChange={(e) => setMediaSearch(e.target.value)}
                  style={{ width: '240px', height: '26px', background: 'rgba(235,235,235,0.6)', border: '1.5px solid #ff9500', borderRadius: '6px', padding: '0 28px 0 10px', fontSize: '13px', outline: 'none' }} />
                <div style={{ position: 'absolute', right: '8px', cursor: 'pointer' }} onClick={() => setSearchOpen(false)}>
                  <i className="fa-solid fa-magnifying-glass" style={{ fontSize: '13px', color: '#777' }}></i>
                </div>
              </div>
              {!mediaSearch.trim() && (
                <div style={{ position: 'absolute', top: '100%', right: '0', marginTop: '6px', background: 'rgba(225,225,225,0.94)', backdropFilter: 'blur(25px)', borderRadius: '16px', padding: '14px', boxShadow: '0 10px 30px rgba(0,0,0,0.15)', zIndex: 9999, width: '270px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ fontSize: '12px', fontWeight: '600', color: '#666', paddingLeft: '4px' }}>Research suggestions</div>
                  {[
                    { ic: 'fa-user-group', t: 'Shared notes' }, { ic: 'fa-lock', t: 'Locked Notes' },
                    { ic: 'fa-list-ul', t: 'Notes with lists' }, { ic: 'fa-hashtag', t: 'Notes with tags' },
                    { ic: 'fa-pen-ruler', t: 'Notes with drawings' }, { ic: 'fa-expand', t: 'Notes with scanned documents' },
                    { ic: 'fa-paperclip', t: 'Notes with attachments' },
                  ].map(({ ic, t }, idx) => (
                    <div
                      key={idx}
                      style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: '#000', cursor: 'pointer', padding: '3px 4px', borderRadius: '6px' }}
                      onClick={() => {
                        if (t === 'Shared notes') {
                          setSearchOpen(false);
                          setMediaSearch('');
                          setShowSharedInbox(true);
                        }
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.05)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <i className={`fa-solid ${ic}`} style={{ width: '18px', textAlign: 'center', color: '#444' }}></i>
                      <span>{t}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        </div>
      </div>
      {/* ═══ FIN TOOLBAR ══════════════════════════════════════════════════ */}

      {/* ═══ ZONE D'ÉDITION ══════════════════════════════════════════════ */}
      <div className="editor-area" id="editor-area">
        <div className="editor-date">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        </div>
        <div id="notes-display" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-start', gap: '20px', padding: '0 24px' }}>
          {note && renderMainStickyNote()}
          {additionalCards.map((card, idx) => renderGroupCard(card, idx))}
        </div>
      </div>

      {/* ═══ FOOTER + BOUTONS BAS (sur la même ligne) ════════════════════ */}
      <div className="editor-bottom" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '14px 20px', background: '#fff', borderTop: '1px solid #e5e7eb' }}>

        {/* Champ titre — visible seulement quand il y a des cartes groupées */}
        {note && note.cards && note.cards.length > 0 && (
          <input
            type="text"
            value={activeCard?.subtitle || ''}
            placeholder="Add a title..."
            onFocus={() => setActiveCardIndex(activeCardIndex)}
            onChange={(e) => updateActiveCard({ subtitle: e.target.value })}
            style={{
              flex: 1,
              maxWidth: '400px',
              border: '1px solid #d1d5db',
              borderRadius: '8px',
              padding: '8px 14px',
              fontSize: '14px',
              background: '#f9f9f9',
              outline: 'none',
              textAlign: 'center',
              color: '#333',
              boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.06)',
            }}
          />
        )}

        {/* Image jaune : ajoute une carte */}
        <button
          type="button"
          onClick={addGroupCard}
          title="Add more notes on the same doc"
          aria-label="Ajouter une carte"
          style={{ width: '62px', height: '62px', padding: 0, border: 'none', borderRadius: '10px', background: '#ffffff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
        >
          <img src={bas1} alt="" aria-hidden="true" style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }} />
        </button>

        {/* Image rouge : supprime la dernière carte */}
        <button
          type="button"
          onClick={removeLastGroupCard}
          title="Remove last note"
          aria-label="Supprimer la dernière carte"
          style={{ width: '62px', height: '62px', padding: 0, border: 'none', borderRadius: '10px', background: '#ffffff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
        >
          <img src={bas2} alt="" aria-hidden="true" style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }} />
        </button>

        {/* Image verte : ouvre la modal pour renommer */}
        <button
          type="button"
          onClick={openRenameModal}
          title="Rename this group of cards"
          aria-label="Renommer le groupe de cartes"
          style={{ width: '62px', height: '62px', padding: 0, border: 'none', borderRadius: '10px', background: '#ffffff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
        >
          <img src={bas3} alt="" aria-hidden="true" style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }} />
        </button>
      </div>

      {/* ═══ MODAL RENOMMAGE ═════════════════════════════════════════════ */}
      {isRenameModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: '#000000', borderRadius: '24px', width: '750px', padding: '25px 40px', boxShadow: '0 20px 40px rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '30px' }}>
            <input
              type="text"
              placeholder="Add Title for theses notes"
              value={tempTitle}
              onChange={(e) => setTempTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveGroupTitle()}
              autoFocus
              style={{ flex: 1, background: 'transparent', border: 'none', borderBottom: '2px solid #555555', color: '#ffffff', fontSize: '20px', fontWeight: '500', padding: '8px 0', outline: 'none' }}
            />
            <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
              <button onClick={saveGroupTitle} style={{ background: '#8cb4e6', color: '#ffffff', border: 'none', borderRadius: '12px', padding: '12px 28px', fontSize: '18px', fontWeight: 'bold', cursor: 'pointer', minWidth: '95px' }}>
                Save
              </button>
              <button onClick={() => setIsRenameModalOpen(false)} style={{ background: '#ffffff', color: '#000000', border: 'none', borderRadius: '12px', padding: '12px 28px', fontSize: '18px', fontWeight: 'bold', cursor: 'pointer', minWidth: '95px' }}>
                Back
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MODALE PHOTOS ═══════════════════════════════════════════════ */}
      {mediaModal && (
        <div className="media-modal-overlay" onClick={() => { setMediaModal(false); setSelectedImg(null); }}>
          <div className="media-modal" onClick={(e) => e.stopPropagation()}>
            <div className="media-modal-traffic">
              <button className="traffic green" onClick={() => { setMediaModal(false); setSelectedImg(null); }} />
              <button className="traffic yellow" onClick={() => { setMediaModal(false); setSelectedImg(null); }} />
              <button className="traffic red" onClick={() => { setMediaModal(false); setSelectedImg(null); }} />
            </div>
            <div className="media-modal-tabs">
              <button className={`media-tab-btn${mediaTab === 'photos' ? ' active' : ''}`} onClick={() => setMediaTab('photos')}>
                <i className="fa-regular fa-image" style={{ marginRight: '6px' }}></i>Photos
              </button>
              <button className={`media-tab-btn${mediaTab === 'videos' ? ' active' : ''}`} onClick={() => setMediaTab('videos')}>
                <i className="fa-regular fa-circle-play" style={{ marginRight: '6px' }}></i>Videos
              </button>
            </div>
            <div className="media-modal-grid">
              {mediaAssets.filter((asset) => {
                const matchesTab = mediaTab === 'photos'
                  ? asset.mime_type?.startsWith('image/')
                  : asset.mime_type?.startsWith('video/');
                return matchesTab && (mediaSearch.trim() === '' || asset.name.toLowerCase().includes(mediaSearch.toLowerCase()));
              }).map((asset) => (
                <div key={asset.id} className={`media-grid-item${selectedImg?.id === asset.id ? ' selected' : ''}`} onClick={() => setSelectedImg(selectedImg?.id === asset.id ? null : asset)}>
                  {asset.mime_type?.startsWith('video/') ? (
                    <div style={{ position: 'relative' }}>
                      <video src={asset.src} muted preload="metadata" style={{ width: '100%', height: '80px', objectFit: 'cover' }} />
                      <i className="fa-solid fa-circle-play" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', color: '#fff', fontSize: '24px', textShadow: '0 1px 4px rgba(0,0,0,0.5)' }} />
                    </div>
                  ) : (
                    <img src={asset.src} alt={asset.name} />
                  )}
                  <div className="media-grid-name">{asset.name.length > 12 ? asset.name.slice(0, 9) + '...' : asset.name}</div>
                </div>
              ))}
              {!mediaLoading && mediaAssets.length === 0 && (
                <div className="media-empty">
                  <i className="fa-regular fa-image" style={{ fontSize: '32px', color: '#ccc' }}></i>
                  <p style={{ fontSize: '12px', color: '#aaa', marginTop: '8px' }}>Aucune photo.<br/>
                    <span style={{ color: '#007AFF', cursor: 'pointer' }} onClick={() => fileInputRef.current?.click()}>Importer depuis l'appareil</span>
                  </p>
                </div>
              )}
            </div>
            <div className="media-modal-footer">
              <div className="media-search-wrap">
                <input type="text" placeholder="Search" className="media-search-input" value={mediaSearch} onChange={(e) => setMediaSearch(e.target.value)} />
                <i className="fa-solid fa-magnifying-glass media-search-icon"></i>
              </div>
              {selectedImg && <button className="media-insert-btn" onClick={insertSelectedImg}>Insert</button>}
              <span className="media-count">{mediaAssets.filter((asset) => mediaTab === 'photos' ? asset.mime_type?.startsWith('image/') : asset.mime_type?.startsWith('video/')).length}</span>
            </div>
          </div>
        </div>
      )}

      {showSharedInbox && (
        <div
          className="modal-overlay"
          onClick={() => setShowSharedInbox(false)}
          style={{ zIndex: 12000, padding: '24px', boxSizing: 'border-box', overflowY: 'auto' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: '680px', position: 'relative' }}
          >
            <button
              type="button"
              onClick={() => setShowSharedInbox(false)}
              aria-label="Fermer les notes partagées"
              style={{
                position: 'absolute',
                right: '14px',
                top: '14px',
                zIndex: 2,
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                border: '1px solid #ddd',
                background: '#fff',
                color: '#111',
                cursor: 'pointer',
                fontSize: '16px',
                lineHeight: 1,
              }}
            >
              ×
            </button>

            <SharedNotesInbox
              onOpenNote={(sharedNote) => {
                setNotes((previousNotes) => {
                  const exists = previousNotes.some((currentNote) => currentNote.id === sharedNote.id);
                  if (exists) return previousNotes;
                  return [sharedNote, ...previousNotes];
                });
                setShowSharedInbox(false);
              }}
              onClose={() => setShowSharedInbox(false)}
            />
          </div>
        </div>
      )}

      {/* ═══ TUNNEL LOCK ═════════════════════════════════════════════════ */}
      {lockStep && (
        <div className="modal-overlay" onClick={() => setLockStep(null)}>
          {lockStep === 'options' && (
            <div className="lock-modal" onClick={(e) => e.stopPropagation()}>
              <button className="close-x" onClick={() => setLockStep(null)}>✕</button>
              <div className="lock-icon-circle"><i className="fa-solid fa-lock"></i></div>
              <h2>Choisissez une option ci-dessous</h2>
              <button className="btn-lock-yellow" onClick={() => { setLockMode('session'); setLockStep('info-page1'); }}>Utiliser le mot de passe de session</button>
              <button className="btn-lock-outline" onClick={() => { setLockMode('custom'); setLockStep('info-page2'); }}>Créer un mot de passe personnalisé</button>
              <span className="lock-link">En savoir plus</span>
            </div>
          )}
          {lockStep === 'info-page1' && (
            <div className="lock-modal" onClick={(e) => e.stopPropagation()}>
              <button className="close-x" onClick={() => setLockStep(null)}>✕</button>
              <div className="lock-icon-circle"><i className="fa-solid fa-lock"></i></div>
              <h2>Verrouiller avec le mot de passe de session</h2>
              <p>L'utilisation du code d'accès de votre appareil vous évite d'avoir à retenir un mot de passe distinct.</p>
              <div className="lock-dots"><div className="lock-dot active"/><div className="lock-dot"/></div>
              <button className="btn-lock-yellow" onClick={() => { setLockMode('session'); setPassword(''); setLockError(''); setLockStep('password-input'); }}>Utiliser la session</button>
            </div>
          )}
          {lockStep === 'info-page2' && (
            <div className="lock-modal" onClick={(e) => e.stopPropagation()}>
              <button className="close-x" onClick={() => setLockStep(null)}>✕</button>
              <div className="lock-icon-circle"><i className="fa-solid fa-lock"></i></div>
              <h2>Créer un mot de passe distinct</h2>
              <p>La création d'un mot de passe dédié apporte une couche de sécurité supplémentaire.</p>
              <div className="lock-dots"><div className="lock-dot"/><div className="lock-dot active"/></div>
              <button className="btn-lock-yellow" onClick={() => { setLockMode('custom'); setPassword(''); setLockError(''); setLockStep('password-input'); }}>Créer pour cette note</button>
            </div>
          )}
          {lockStep === 'password-input' && (
            <div className="lock-modal" onClick={(e) => e.stopPropagation()}>
              <div className="lock-icon-circle"><i className="fa-solid fa-lock"></i></div>
              <h2 style={{ marginBottom: '5px' }}>SpaceNotes</h2>
              <p style={{ color: '#666', fontSize: '13px', marginBottom: '22px' }}>
                {activeCard?.isLocked || lockMode === 'unlock'
                  ? 'Saisissez le mot de passe pour déverrouiller cette slide.'
                  : lockMode === 'session'
                    ? 'Confirmez votre mot de passe de connexion pour verrouiller cette slide.'
                    : 'Créez un mot de passe distinct pour verrouiller cette slide.'}
              </p>
              <div style={{ position: 'relative', width: '100%' }}>
                <input
                  type={showLockPassword ? 'text' : 'password'}
                  className="lock-input"
                  style={{ paddingRight: '46px' }}
                  placeholder="Mot de passe"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setLockError(''); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleLockNote()}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowLockPassword((visible) => !visible)}
                  aria-label={showLockPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  style={{ position: 'absolute', right: '12px', top: '12px', border: 'none', background: 'transparent', color: '#777', cursor: 'pointer', fontSize: '16px' }}
                >
                  <i className={`fa-regular ${showLockPassword ? 'fa-eye' : 'fa-eye-slash'}`}></i>
                </button>
              </div>
              {lockError && <div role="alert" style={{ color: '#dc2626', fontSize: '13px', margin: '-8px 0 16px' }}>{lockError}</div>}
              <div className="lock-modal-actions">
                <button className="btn-lock-cancel" onClick={() => setLockStep(activeCard?.isLocked ? null : 'options')}>Annuler</button>
                <button className="btn-lock-yellow" style={{ flex: 1, margin: 0 }} onClick={handleLockNote} disabled={lockBusy}>
                  {lockBusy ? 'Vérification…' : 'Confirmer'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}