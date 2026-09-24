import { supabase } from '../lib/supabase';

async function getCurrentUserId() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error('Vous devez être connecté.');
  }

  return user.id;
}

async function fetchSharesWithNotesAndOwners(status) {
  const userId = await getCurrentUserId();

  const { data: shares, error } = await supabase
    .from('note_shares')
    .select(
      'id, note_id, permission, status, created_at, accepted_at, note:notes(id, title, content, color, folder, cards, is_locked, user_id)'
    )
    .eq('recipient_id', userId)
    .eq('status', status)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const ownerIds = [...new Set((shares || []).map((share) => share.note?.user_id).filter(Boolean))];

  let ownersById = {};
  if (ownerIds.length > 0) {
    const { data: owners, error: ownersError } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url')
      .in('id', ownerIds);

    if (ownersError) {
      throw new Error(ownersError.message);
    }

    ownersById = Object.fromEntries((owners || []).map((owner) => [owner.id, owner]));
  }

  return (shares || []).map((share) => ({
    ...share,
    owner: share.note ? ownersById[share.note.user_id] : null,
  }));
}

export async function getPendingNoteShares() {
  return fetchSharesWithNotesAndOwners('pending');
}

export async function getAcceptedSharedNotes() {
  return fetchSharesWithNotesAndOwners('accepted');
}

export async function acceptNoteShare(shareId) {
  const userId = await getCurrentUserId();

  const { error } = await supabase
    .from('note_shares')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', shareId)
    .eq('recipient_id', userId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function declineNoteShare(shareId) {
  const userId = await getCurrentUserId();

  const { error } = await supabase
    .from('note_shares')
    .update({ status: 'declined' })
    .eq('id', shareId)
    .eq('recipient_id', userId);

  if (error) {
    throw new Error(error.message);
  }
}
