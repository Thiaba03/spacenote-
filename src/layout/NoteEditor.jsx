import { useEffect, useState, useRef } from 'react';
import { COLOR_PALETTES } from '../constants/colors';
import { supabase } from '../lib/supabase';
import bas1 from './bas1.png';
import bas2 from './bas2.png';
import bas3 from './bas3.png';

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
  const [listTypesByNote, setListTypesByNote] = useState({});
  const [mediaModal, setMediaModal]   = useState(false);
  const [mediaTab, setMediaTab]       = useState('photos');
  const [selectedImg, setSelectedImg] = useState(null);
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

  const note        = notes.find((n) => n.id === selectedId);
  const activePal   = note ? (COLOR_PALETTES[note.color] || COLOR_PALETTES['Yellow']) : COLOR_PALETTES['Yellow'];
  const additionalCards = note && note.cards ? note.cards.slice(1) : [];
  const currentMainText = note?.cards?.[0]?.text ?? note?.text ?? '';
  const firstMainLine = currentMainText.split('\n')[0] || '';
  const detectedListType = Object.entries(LIST_PREFIXES).find(([type, prefix]) => (
    type === 'num' ? /^\d+\.\s/.test(firstMainLine) : firstMainLine.startsWith(prefix)
  ))?.[0] || null;
  const activeListType = Object.prototype.hasOwnProperty.call(listTypesByNote, selectedId)
    ? listTypesByNote[selectedId]
    : detectedListType;
  const setActiveListType = (value) => {
    setListTypesByNote((previousTypes) => ({ ...previousTypes, [selectedId]: value }));
  };

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

  const updateNote = (patch) =>
    setNotes((prev) => prev.map((n) => (n.id === selectedId ? { ...n, ...patch } : n)));

  const setColor = (colorName) => { updateNote({ color: colorName }); closeAll(); };

  // ── Modal renommage ───────────────────────────────────────────────────────
  const openRenameModal = () => {
    if (!note) return;
    setTempTitle(note.title || '');
    setIsRenameModalOpen(true);
  };

  const saveGroupTitle = () => {
    updateNote({ title: tempTitle || 'Untitled' });
    setIsRenameModalOpen(false);
  };

  // ── Liste ─────────────────────────────────────────────────────────────────
  const updateMainText = (value) => {
    setNotes((previousNotes) => previousNotes.map((currentNote) => {
      if (currentNote.id !== selectedId) return currentNote;
      const updatedCards = [...(currentNote.cards || [])];
      if (updatedCards[0]) updatedCards[0] = { ...updatedCards[0], text: value };
      return { ...currentNote, text: value, cards: updatedCards };
    }));
  };

  const mainTextFormat = {
    ...DEFAULT_TEXT_FORMAT,
    ...(note?.cards?.[0]?.format || {}),
  };

  const updateMainTextFormat = (patch) => {
    setNotes((previousNotes) => previousNotes.map((currentNote) => {
      if (currentNote.id !== selectedId) return currentNote;
      const updatedCards = [...(currentNote.cards || [])];
      const firstCard = updatedCards[0] || {
        id: crypto.randomUUID(),
        subtitle: currentNote.title || 'Untitled',
        text: currentNote.text || '',
      };
      updatedCards[0] = {
        ...firstCard,
        format: {
          ...DEFAULT_TEXT_FORMAT,
          ...(firstCard.format || {}),
          ...patch,
        },
      };
      return { ...currentNote, cards: updatedCards };
    }));
  };

  const setTextStyle = (styleName) => {
    if (styleName === 'monospace') {
      updateMainTextFormat({ style: styleName, fontFamily: '"Courier New", monospace' });
      return;
    }
    updateMainTextFormat({ style: styleName });
  };

  const removeListFormatting = (text) => text
    .split('\n')
    .map((line) => line.replace(LIST_PREFIX_PATTERN, ''))
    .join('\n');

  const disableList = () => {
    if (!note) return;
    const currentText = note.cards?.[0]?.text ?? note.text ?? '';
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

    const currentText = note.cards?.[0]?.text ?? note.text ?? '';
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
    updateNote({ tables: [...(note.tables || []), newTable] });
    closeAll();
  };

  const updateCell = (tableId, r, c, value) => {
    const tables = (note.tables || []).map((t) => {
      if (t.id !== tableId) return t;
      return { ...t, data: t.data.map((row, ri) => ri === r ? row.map((cell, ci) => ci === c ? value : cell) : row) };
    });
    updateNote({ tables });
  };

  const tableAddColBefore = (tableId, colIdx) => {
    const tables = (note.tables || []).map((t) => t.id !== tableId ? t : { ...t, cols: t.cols + 1, data: t.data.map((row) => [...row.slice(0, colIdx), '', ...row.slice(colIdx)]) });
    updateNote({ tables }); setTableCtxMenu(null);
  };
  const tableAddColAfter = (tableId, colIdx) => {
    const tables = (note.tables || []).map((t) => t.id !== tableId ? t : { ...t, cols: t.cols + 1, data: t.data.map((row) => [...row.slice(0, colIdx + 1), '', ...row.slice(colIdx + 1)]) });
    updateNote({ tables }); setTableCtxMenu(null);
  };
  const tableDeleteCol = (tableId, colIdx) => {
    const tables = (note.tables || []).map((t) => (t.id !== tableId || t.cols <= 1) ? t : { ...t, cols: t.cols - 1, data: t.data.map((row) => row.filter((_, ci) => ci !== colIdx)) });
    updateNote({ tables }); setTableCtxMenu(null);
  };
  const tableAddRowBefore = (tableId, rowIdx) => {
    const tables = (note.tables || []).map((t) => t.id !== tableId ? t : {
      ...t,
      rows: t.rows + 1,
      data: [...t.data.slice(0, rowIdx), Array(t.cols).fill(''), ...t.data.slice(rowIdx)],
    });
    updateNote({ tables }); setTableCtxMenu(null);
  };
  const tableAddRowAfter = (tableId, rowIdx) => {
    const tables = (note.tables || []).map((t) => t.id !== tableId ? t : {
      ...t,
      rows: t.rows + 1,
      data: [...t.data.slice(0, rowIdx + 1), Array(t.cols).fill(''), ...t.data.slice(rowIdx + 1)],
    });
    updateNote({ tables }); setTableCtxMenu(null);
  };
  const tableDeleteRow = (tableId, rowIdx) => {
    const tables = (note.tables || []).map((t) => (t.id !== tableId || t.rows <= 1) ? t : {
      ...t,
      rows: t.rows - 1,
      data: t.data.filter((_, index) => index !== rowIdx),
    });
    updateNote({ tables }); setTableCtxMenu(null);
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
    updateNote({ images: [...(note.images || []), {
      id: crypto.randomUUID(), assetId: selectedImg.id, name: selectedImg.name,
      path: selectedImg.path, mime_type: selectedImg.mime_type, src: selectedImg.src,
    }] });
    setMediaModal(false); setSelectedImg(null);
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

    const linkAlreadyExists = (note.links || []).some(
      (existingLink) => normalizeUrl(existingLink.url) === normalizedUrl
    );
    if (linkAlreadyExists) {
      setLinkError('Ce lien est déjà présent dans cette note.');
      return;
    }

    updateNote({
      links: [
        ...(note.links || []),
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
    setNotes((prev) =>
      prev.map((n) =>
        n.id === selectedId
          ? { ...n, cards: [...(n.cards || [{ id: n.id, subtitle: n.title, text: n.text }]), { id: crypto.randomUUID(), subtitle: 'Untitled', text: '' }] }
          : n
      )
    );
  };

  const removeLastGroupCard = () => {
    setNotes((prev) =>
      prev.map((n) =>
        n.id === selectedId && n.cards && n.cards.length > 1
          ? { ...n, cards: n.cards.slice(0, -1) }
          : n
      )
    );
  };

  // ── Lock ──────────────────────────────────────────────────────────────────
  const handleLockToggleAction = () => {
    setPassword('');
    setLockError('');
    setShowLockPassword(false);

    if (note?.isLocked) {
      setLockMode('unlock');
      setLockStep('password-input');
    } else if (note?.lockPasswordHash && note?.lockPasswordSalt) {
      updateNote({ isLocked: true });
      setLockStep(null);
    } else {
      setLockStep('options');
    }
    setOpenDD(null);
  };

  const handleLockNote = async () => {
    if (!note || lockBusy) return;
    if (password.length < 6) {
      setLockError('Le mot de passe doit contenir au moins 6 caractères.');
      return;
    }

    setLockBusy(true);
    setLockError('');

    try {
      if (note.isLocked || lockMode === 'unlock') {
        if (!note.lockPasswordHash || !note.lockPasswordSalt) {
          setLockError('Cette ancienne note ne possède pas encore de mot de passe sécurisé.');
          return;
        }
        const candidateHash = await derivePasswordHash(password, note.lockPasswordSalt);
        if (!hashesMatch(candidateHash, note.lockPasswordHash)) {
          setLockError('Mot de passe incorrect.');
          return;
        }
        updateNote({ isLocked: false });
      } else {
        if (lockMode === 'session') {
          const { data: userData, error: userError } = await supabase.auth.getUser();
          const email = userData?.user?.email;
          if (userError || !email) {
            setLockError('Impossible de vérifier votre session.');
            return;
          }
          const { error: sessionPasswordError } = await supabase.auth.signInWithPassword({
            email,
            password,
          });
          if (sessionPasswordError) {
            setLockError('Le mot de passe de session est incorrect.');
            return;
          }
        }

        const salt = createPasswordSalt();
        const passwordHash = await derivePasswordHash(password, salt);
        updateNote({
          isLocked: true,
          lockPasswordHash: passwordHash,
          lockPasswordSalt: salt,
        });
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
    setNotes((previousNotes) => previousNotes.map((currentNote) => (
      currentNote.lockPasswordHash && currentNote.lockPasswordSalt
        ? { ...currentNote, isLocked: true }
        : currentNote
    )));
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


  // ── Rendu note principale ─────────────────────────────────────────────────
  const renderMainStickyNote = () => {
    if (!note) return null;
    const pal = activePal;
    const mainText = note.cards && note.cards[0] ? note.cards[0].text : note.text;

    return (
      <div className="sticky-note" style={{ background: pal.body, width: CARD_WIDTH, height: CARD_MIN_HEIGHT, maxHeight: CARD_MIN_HEIGHT, flex: '0 0 auto', position: 'relative', borderRadius: '6px', boxShadow: '0 3px 8px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column', overflow: 'hidden', clipPath: 'none' }}>
        <div className="sticky-header-bar" style={{ background: pal.header, color: pal.text, fontWeight: 800, fontSize: '20px', padding: '22px 20px', textAlign: 'center', borderBottom: '2px solid rgba(0,0,0,0.12)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: '0 0 auto' }}>
          {note.isLocked ? '🔒 Contenu Protégé' : note.title}
        </div>
        <div
          className="sticky-body sticky-body-scroll"
          style={{ padding: '18px 20px', flex: 1, display: 'flex', flexDirection: 'column', ...SCROLLABLE_BODY_STYLE }}
        >
          {note.isLocked ? (
            <div className="lock-masked-screen">
              <i className="fa-solid fa-lock lock-masked-icon"></i>
              <p className="lock-masked-text">Cette note est protégée.</p>
              <button className="btn-lock-yellow" style={{ width: 'auto', padding: '8px 20px', marginTop: '10px' }} onClick={() => { setLockMode('unlock'); setPassword(''); setLockError(''); setLockStep('password-input'); }}>
                Saisir le mot de passe
              </button>
            </div>
          ) : (
            <>
              {(note.images || []).map((media) => (
                <div key={media.id} className="note-image-block" style={{ flexShrink: 0, flexGrow: 0, width: '100%' }}>
                  {media.mime_type?.startsWith('video/') ? (
                    <video src={media.src} controls playsInline preload="metadata"
                      style={{ width: '100%', height: '260px', maxHeight: '260px', objectFit: 'contain', borderRadius: '6px', display: 'block' }} />
                  ) : (
                    <img src={media.src} alt={media.name} style={{ width: '100%', height: '260px', maxHeight: '260px', objectFit: 'contain', borderRadius: '6px', display: 'block' }} />
                  )}
                  <button className="note-image-remove" onClick={() => updateNote({ images: (note.images || []).filter((i) => i.id !== media.id) })}>✕</button>
                </div>
              ))}
              {(note.links || []).map((lnk) => (
                <div key={lnk.id} className="link-preview-card" style={{ flexShrink: 0 }}>
                  {lnk.thumbnail && (
                    <div className="link-preview-thumb">
                      <img src={lnk.thumbnail} alt={lnk.title} />
                      {lnk.type === 'youtube' && <div className="link-preview-play"><i className="fa-solid fa-play"></i></div>}
                    </div>
                  )}
                  <div className="link-preview-info">
                    <a
                      href={normalizeUrl(lnk.url) || '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Ouvrir le lien dans un nouvel onglet"
                      style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}
                    >
                      <div className="link-preview-desc">{lnk.description}</div>
                      <div className="link-preview-site">{lnk.siteName}</div>
                    </a>
                  </div>
                  <div className="link-preview-bar" style={{ background: pal.header }} />
                  <button className="link-preview-remove" onClick={() => updateNote({ links: (note.links || []).filter((l) => l.id !== lnk.id) })}>✕</button>
                </div>
              ))}
              <textarea
                value={mainText || ''}
                placeholder="Start a note..."
                style={{
                  color: mainTextFormat.color || pal.darkText,
                  width: '100%',
                  minHeight: (note.tables || []).length > 0 ? '80px' : '120px',
                  flex: '0 0 auto',
                  flexShrink: 0,
                  overflow: 'hidden',
                  background: mainTextFormat.backgroundColor || 'transparent',
                  border: 'none',
                  borderLeft: mainTextFormat.style === 'quote' ? '3px solid #ff9500' : 'none',
                  outline: 'none',
                  resize: 'none',
                  paddingLeft: mainTextFormat.style === 'quote' ? '12px' : '0',
                  fontSize: `${mainTextFormat.fontSize}px`,
                  lineHeight: 1.6,
                  fontFamily: mainTextFormat.fontFamily,
                  fontWeight: mainTextFormat.bold ? '700' : '400',
                  fontStyle: mainTextFormat.italic ? 'italic' : 'normal',
                  textDecoration: [
                    mainTextFormat.underline ? 'underline' : '',
                    mainTextFormat.strike ? 'line-through' : '',
                  ].filter(Boolean).join(' ') || 'none',
                  textAlign: mainTextFormat.align,
                }}
                onChange={(e) => updateMainText(e.target.value)}
                onInput={(e) => {
                  e.target.style.height = 'auto';
                  e.target.style.height = `${e.target.scrollHeight}px`;
                }}
                ref={(el) => {
                  mainTextareaRef.current = el;
                  if (el) {
                    el.style.height = 'auto';
                    el.style.height = `${el.scrollHeight}px`;
                  }
                }}
                onKeyDown={handleListKeyDown}
              />
              {(note.tables || []).map((tbl) => (
                <div key={tbl.id} className="note-table-wrapper" style={{ position: 'relative', order: -1, margin: '4px 0 12px', padding: '20px 0 0 20px', flexShrink: 0 }}>
                  {Array.from({ length: tbl.cols }).map((_, ci) => {
                    const isActive = tableCtxMenu?.tableId === tbl.id && tableCtxMenu?.type === 'column' && tableCtxMenu?.index === ci;
                    return (
                      <button
                        key={`column-${ci}`}
                        type="button"
                        className="col-handle"
                        aria-label={`Options de la colonne ${ci + 1}`}
                        onClick={(e) => { e.stopPropagation(); setTableCtxMenu({ tableId: tbl.id, type: 'column', index: ci }); }}
                        style={{
                          position: 'absolute', top: 0,
                          left: `calc(20px + ${(ci / tbl.cols) * 100}% - ${(ci / tbl.cols) * 20}px)`,
                          width: `calc(${100 / tbl.cols}% - ${20 / tbl.cols}px)`, height: '20px',
                          padding: 0, border: 'none', borderRadius: '5px 5px 0 0',
                          background: isActive ? '#ffb800' : 'transparent', color: isActive ? '#fff' : '#b8b8b8',
                          cursor: 'pointer', fontSize: '15px', lineHeight: 1,
                        }}
                      >•••</button>
                    );
                  })}
                  {Array.from({ length: tbl.rows }).map((_, ri) => {
                    const isActive = tableCtxMenu?.tableId === tbl.id && tableCtxMenu?.type === 'row' && tableCtxMenu?.index === ri;
                    return (
                      <button
                        key={`row-${ri}`}
                        type="button"
                        className="row-handle"
                        aria-label={`Options de la ligne ${ri + 1}`}
                        onClick={(e) => { e.stopPropagation(); setTableCtxMenu({ tableId: tbl.id, type: 'row', index: ri }); }}
                        style={{
                          position: 'absolute', left: 0,
                          top: `calc(20px + ${(ri / tbl.rows) * 100}% - ${(ri / tbl.rows) * 20}px)`,
                          width: '20px', height: `calc(${100 / tbl.rows}% - ${20 / tbl.rows}px)`,
                          padding: 0, border: 'none', borderRadius: '5px 0 0 5px',
                          background: isActive ? '#ffb800' : 'transparent', color: isActive ? '#fff' : '#b8b8b8',
                          cursor: 'pointer', fontSize: '14px', lineHeight: 0.55,
                          writingMode: 'vertical-rl',
                        }}
                      >•••</button>
                    );
                  })}
                  <table className="note-table" style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
                    <tbody>
                      {tbl.data.map((row, ri) => (
                        <tr key={ri}>
                          {row.map((cell, ci) => (
                            <td key={ci} style={{ border: '1px solid #a9a9a9', padding: '2px', height: '54px' }}>
                              <input value={cell} onChange={(e) => updateCell(tbl.id, ri, ci, e.target.value)}
                                onFocus={() => setTableCtxMenu(null)}
                                style={{ width: '100%', height: '100%', border: 'none', background: 'transparent', outline: 'none', fontSize: '13px', padding: '7px', color: pal.darkText, boxSizing: 'border-box' }} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {tableCtxMenu?.tableId === tbl.id && (
                    <div className="table-ctx-menu" onClick={(e) => e.stopPropagation()}
                      style={{
                        position: 'absolute', zIndex: 999, minWidth: '170px', overflow: 'hidden',
                        top: tableCtxMenu.type === 'column' ? '20px' : `calc(20px + ${(tableCtxMenu.index / tbl.rows) * 100}%)`,
                        left: tableCtxMenu.type === 'column' ? `calc(20px + ${(tableCtxMenu.index / tbl.cols) * 100}%)` : '-150px',
                        background: 'rgba(238,238,238,0.98)', border: '1px solid #dedede', borderRadius: '8px',
                        boxShadow: '0 5px 18px rgba(0,0,0,.18)',
                      }}>
                      {(tableCtxMenu.type === 'column' ? [
                        { label: 'Insert a front column', action: () => tableAddColBefore(tbl.id, tableCtxMenu.index) },
                        { label: 'Insert column after', action: () => tableAddColAfter(tbl.id, tableCtxMenu.index) },
                        { label: 'Delete column', action: () => tableDeleteCol(tbl.id, tableCtxMenu.index), destructive: true },
                      ] : [
                        { label: 'Insert a row above', action: () => tableAddRowBefore(tbl.id, tableCtxMenu.index) },
                        { label: 'Insert a row below', action: () => tableAddRowAfter(tbl.id, tableCtxMenu.index) },
                        { label: 'Delete row', action: () => tableDeleteRow(tbl.id, tableCtxMenu.index), destructive: true },
                      ]).map(({ label, action, destructive }, optionIndex) => (
                        <button key={label} onClick={action}
                          style={{ display: 'block', width: '100%', padding: '9px 14px', textAlign: 'left', background: 'none', border: 'none', borderTop: optionIndex === 2 ? '1px solid #c9c9c9' : 'none', cursor: 'pointer', fontSize: '13px', color: destructive ? '#111' : '#111' }}
                          onMouseEnter={(e) => e.currentTarget.style.background = '#f5f5f5'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'none'}>
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
        <FoldedCorner />
      </div>
    );
  };

  
  // ── Rendu carte supplémentaire ────────────────────────────────────────────
  const renderGroupCard = (card, subIdx) => {
    const pal = activePal;
    const globalIdx = subIdx + 1;
    return (
      <div key={card.id} className="sticky-note" style={{ background: pal.body, width: CARD_WIDTH, height: CARD_MIN_HEIGHT, maxHeight: CARD_MIN_HEIGHT, flex: '0 0 auto', position: 'relative', borderRadius: '6px', boxShadow: '0 3px 8px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="sticky-header-bar" style={{ background: pal.header, color: pal.text, fontWeight: 800, fontSize: '20px', padding: '22px 20px', textAlign: 'center', borderBottom: '2px solid rgba(0,0,0,0.12)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: '0 0 auto' }}>
          {card.subtitle || 'Untitled'}
        </div>
        <div className="sticky-body sticky-body-scroll" style={{ padding: '18px 20px', flex: 1, ...SCROLLABLE_BODY_STYLE }}>
          <textarea
            value={card.text || ''}
            placeholder="Start a note..."
            style={{ color: pal.darkText, width: '100%', minHeight: '120px', flexShrink: 0, overflow: 'hidden', background: 'transparent', border: 'none', outline: 'none', resize: 'none', fontSize: '15px', lineHeight: 1.6, fontFamily: 'inherit' }}
            onInput={(e) => {
              e.target.style.height = 'auto';
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            ref={(el) => {
              if (el) {
                el.style.height = 'auto';
                el.style.height = `${el.scrollHeight}px`;
              }
            }}
            onChange={(e) => {
              setNotes((prev) => prev.map((n) => {
                if (n.id !== selectedId) return n;
                const updatedCards = (n.cards || []).map((c, i) => i === globalIdx ? { ...c, text: e.target.value } : c);
                return { ...n, cards: updatedCards };
              }));
            }}
          />
        </div>
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
                    {note?.color === name && <i className="fa-solid fa-check check-icon" style={{ color: '#007AFF' }}></i>}
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
    title={
      note?.tables?.length > 0
        ? 'Add another table'
        : 'Add a table'
    }
    style={{
      background:
        note?.tables?.length > 0
          ? '#dcdcdc'
          : 'transparent',
      borderRadius: '5px',
      border: 'none',
      padding: '6px 10px',
      cursor: 'pointer',
    }}
  >
    <svg
      width="18"
      height="14"
      viewBox="0 0 18 14"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="0.5"
        y="0.5"
        width="17"
        height="13"
        rx="1.5"
        stroke="#857f7f"
        strokeWidth="1"
      />
      <line
        x1="9"
        y1="0.5"
        x2="9"
        y2="13.5"
        stroke="#857f7f"
        strokeWidth="1"
      />
      <line
        x1="0.5"
        y1="7"
        x2="17.5"
        y2="7"
        stroke="#857f7f"
        strokeWidth="1"
      />
    </svg>
  </button>
</div>

        {/* ── IMAGE / MEDIA ── */}
        <div className="rel">
          {/* IMAGE / MEDIA */}
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
          {/* LOCK */}
<button
  onClick={() => toggle('lock')}
  title="Verrouiller"
  className={`toolbar-light-icon ${
    openDD === 'lock' || note?.isLocked ? 'active' : ''
  }`}
>
  <i
    className={`fa-solid ${
      note?.isLocked ? 'fa-lock' : 'fa-lock-open'
    }`}
  ></i>
</button>
          {openDD === 'lock' && (
            <div className="lock-dropdown">
              <button className="lock-item" onClick={handleLockToggleAction}>{note?.isLocked ? 'Unlock this note' : 'Lock this note'}</button>
              <button className="lock-item" onClick={handleCloseAllLockedNotes}>Close all locked notes</button>
            </div>
          )}
        </div>

        {/* ── PARTAGER ── */}
        <div className="rel">
          <button
  onClick={() => toggle('share')}
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
                <select className="share-action-select"><option>Send a copy</option><option>Collaborate</option></select>
              </div>
              <div className="share-section-title">SpaceChat / GhostLabs Contacts</div>
              <div className="share-contacts-row">
                {[{ name: 'Moses', cls: 'avatar-yellow' }, { name: 'Adam', cls: 'avatar-green' }, { name: 'Kahina', cls: 'avatar-purple' }].map(({ name, cls }) => (
                  <div key={name} className="contact-item" onClick={closeAll}>
                    <div className={`contact-avatar ${cls}`}><i className="fa-solid fa-user"></i></div>
                    <span>{name}</span>
                  </div>
                ))}
              </div>
              <div className="share-divider"></div>
              <div className="share-app-row" onClick={closeAll}>
                <div className="app-icon-mail"><i className="fa-solid fa-envelope"></i></div>
                <span className="app-label">Mail</span>
              </div>
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
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: '#000', cursor: 'pointer', padding: '3px 4px', borderRadius: '6px' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.05)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
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
            value={note.title || ''}
            placeholder="Add a title..."
            onChange={(e) => updateNote({ title: e.target.value })}
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
          style={{
            width: '62px',
            height: '62px',
            padding: 0,
            border: 'none',
            borderRadius: '10px',
            background: '#ffffff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          <img
            src={bas1}
            alt=""
            aria-hidden="true"
            style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
          />
        </button>

        {/* Image rouge : supprime la dernière carte */}
        <button
          type="button"
          onClick={removeLastGroupCard}
          title="Remove last note"
          aria-label="Supprimer la dernière carte"
          style={{
            width: '62px',
            height: '62px',
            padding: 0,
            border: 'none',
            borderRadius: '10px',
            background: '#ffffff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          <img
            src={bas2}
            alt=""
            aria-hidden="true"
            style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
          />
        </button>

        {/* Image verte : ouvre la modal pour renommer */}
        <button
          type="button"
          onClick={openRenameModal}
          title="Rename this group of cards"
          aria-label="Renommer le groupe de cartes"
          style={{
            width: '62px',
            height: '62px',
            padding: 0,
            border: 'none',
            borderRadius: '10px',
            background: '#ffffff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          <img
            src={bas3}
            alt=""
            aria-hidden="true"
            style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
          />
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
                {note?.isLocked || lockMode === 'unlock'
                  ? 'Saisissez le mot de passe pour déverrouiller cette note.'
                  : lockMode === 'session'
                    ? 'Confirmez votre mot de passe de connexion pour verrouiller cette note.'
                    : 'Créez un mot de passe distinct pour verrouiller cette note.'}
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
                <button className="btn-lock-cancel" onClick={() => setLockStep(note?.isLocked ? null : 'options')}>Annuler</button>
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