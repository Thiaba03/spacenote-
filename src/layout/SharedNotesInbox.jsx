import React, { useCallback, useEffect, useState } from 'react';
import {
  acceptNoteShare,
  declineNoteShare,
  getAcceptedSharedNotes,
  getPendingNoteShares,
} from './sharedNotesService_v2';

/**
 * Boîte de réception des notes partagées.
 *
 * Props:
 * - onOpenNote(note, share): appelé quand l'utilisateur ouvre une note acceptée.
 * - onClose(): optionnel, pour fermer le panneau/modal parent.
 */
export default function SharedNotesInbox({ onOpenNote, onClose }) {
  const [tab, setTab] = useState('pending');
  const [pending, setPending] = useState([]);
  const [accepted, setAccepted] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const [pendingShares, acceptedShares] = await Promise.all([
        getPendingNoteShares(),
        getAcceptedSharedNotes(),
      ]);

      setPending(pendingShares);
      setAccepted(acceptedShares);
    } catch (err) {
      setError(err?.message || 'Impossible de charger les notes partagées.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleAccept = async (shareId) => {
    setBusyId(shareId);
    setError('');
    setSuccess('');

    try {
      await acceptNoteShare(shareId);
      setSuccess('Partage accepté.');
      setTab('accepted');
      await load();
    } catch (err) {
      setError(err?.message || 'Impossible d’accepter le partage.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDecline = async (shareId) => {
    setBusyId(shareId);
    setError('');
    setSuccess('');

    try {
      await declineNoteShare(shareId);
      setSuccess('Partage refusé.');
      await load();
    } catch (err) {
      setError(err?.message || 'Impossible de refuser le partage.');
    } finally {
      setBusyId(null);
    }
  };

  const formatDate = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  const renderOwner = (share) => {
    const owner = share?.owner;
    return owner?.display_name || owner?.email || 'Utilisateur';
  };

  const renderCard = (share, isPending) => {
    const note = share?.note;
    if (!note) return null;

    return (
      <div
        key={share.id}
        style={{
          border: '1px solid #e8e8e8',
          borderRadius: 16,
          padding: 16,
          background: '#fff',
          boxShadow: '0 2px 10px rgba(0,0,0,0.04)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div
            aria-hidden="true"
            style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              background: note.color || '#f2f2f2',
              flex: '0 0 auto',
            }}
          />

          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: '#111',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {note.title || 'Note sans titre'}
            </div>

            <div style={{ marginTop: 4, fontSize: 13, color: '#777' }}>
              Partagée par {renderOwner(share)}
            </div>

            <div style={{ marginTop: 4, fontSize: 12, color: '#999' }}>
              {formatDate(share.created_at)} · {share.permission === 'editor' ? 'Modification autorisée' : 'Lecture seule'}
            </div>
          </div>
        </div>

        {isPending ? (
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button
              type="button"
              onClick={() => handleAccept(share.id)}
              disabled={busyId === share.id}
              style={{
                flex: 1,
                border: 0,
                borderRadius: 10,
                padding: '10px 12px',
                background: '#111',
                color: '#fff',
                cursor: busyId === share.id ? 'wait' : 'pointer',
                opacity: busyId === share.id ? 0.6 : 1,
              }}
            >
              {busyId === share.id ? '...' : 'Accepter'}
            </button>

            <button
              type="button"
              onClick={() => handleDecline(share.id)}
              disabled={busyId === share.id}
              style={{
                flex: 1,
                border: '1px solid #ddd',
                borderRadius: 10,
                padding: '10px 12px',
                background: '#fff',
                color: '#222',
                cursor: busyId === share.id ? 'wait' : 'pointer',
                opacity: busyId === share.id ? 0.6 : 1,
              }}
            >
              {busyId === share.id ? '...' : 'Refuser'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onOpenNote?.(note, share)}
            style={{
              width: '100%',
              marginTop: 14,
              border: '1px solid #ddd',
              borderRadius: 10,
              padding: '10px 12px',
              background: '#fff',
              color: '#111',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Ouvrir la note
          </button>
        )}
      </div>
    );
  };

  const list = tab === 'pending' ? pending : accepted;

  return (
    <div
      style={{
        width: '100%',
        maxWidth: 620,
        margin: '0 auto',
        background: '#f8f8f8',
        borderRadius: 20,
        padding: 20,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#111' }}>
            Notes partagées
          </div>
          <div style={{ marginTop: 3, fontSize: 13, color: '#777' }}>
            Gérez les invitations et ouvrez les notes auxquelles vous avez accès.
          </div>
        </div>

        <button
          type="button"
          onClick={load}
          disabled={loading}
          aria-label="Actualiser"
          style={{
            border: '1px solid #ddd',
            borderRadius: 10,
            width: 40,
            height: 40,
            background: '#fff',
            cursor: loading ? 'wait' : 'pointer',
          }}
        >
          ↻
        </button>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            style={{
              border: '1px solid #ddd',
              borderRadius: 10,
              width: 40,
              height: 40,
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 6,
          padding: 4,
          background: '#ececec',
          borderRadius: 12,
          marginBottom: 14,
        }}
      >
        <button
          type="button"
          onClick={() => setTab('pending')}
          style={{
            border: 0,
            borderRadius: 9,
            padding: '10px 12px',
            background: tab === 'pending' ? '#fff' : 'transparent',
            fontWeight: tab === 'pending' ? 700 : 500,
            cursor: 'pointer',
          }}
        >
          Invitations {pending.length ? `(${pending.length})` : ''}
        </button>

        <button
          type="button"
          onClick={() => setTab('accepted')}
          style={{
            border: 0,
            borderRadius: 9,
            padding: '10px 12px',
            background: tab === 'accepted' ? '#fff' : 'transparent',
            fontWeight: tab === 'accepted' ? 700 : 500,
            cursor: 'pointer',
          }}
        >
          Mes notes partagées {accepted.length ? `(${accepted.length})` : ''}
        </button>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            marginBottom: 12,
            padding: 12,
            borderRadius: 10,
            background: '#fff0f0',
            color: '#a40000',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {success && (
        <div
          role="status"
          style={{
            marginBottom: 12,
            padding: 12,
            borderRadius: 10,
            background: '#f1f8f1',
            color: '#2d6a2d',
            fontSize: 13,
          }}
        >
          {success}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 30, textAlign: 'center', color: '#777' }}>
          Chargement...
        </div>
      ) : list.length === 0 ? (
        <div
          style={{
            padding: 30,
            textAlign: 'center',
            border: '1px dashed #d5d5d5',
            borderRadius: 16,
            color: '#777',
            background: '#fff',
          }}
        >
          {tab === 'pending'
            ? 'Aucune invitation en attente.'
            : 'Aucune note partagée acceptée.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {list.map((share) => renderCard(share, tab === 'pending'))}
        </div>
      )}
    </div>
  );
}
