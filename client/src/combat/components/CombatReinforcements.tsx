import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Portrait } from '../../components/Portrait';
import type { CombatDto, Creature, SpatialPosition } from '../../types';
import { addCombatParticipants } from '../combatApi';
import '../preparation.css';
export function CombatReinforcements({
  combat,
  position,
  onAdded,
  onError,
}: {
  combat: CombatDto;
  position: SpatialPosition | null;
  onAdded: (combat: CombatDto) => void;
  onError: (message: string) => void;
}) {
  const [rows, setRows] = useState<Creature[]>([]),
    [query, setQuery] = useState(''),
    [kind, setKind] = useState('CREATURE');
  const [selected, setSelected] = useState(''),
    [relation, setRelation] = useState<'hostile' | 'neutral' | 'allied'>(
      'hostile',
    ),
    [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api<{ creatures: Creature[] }>('/api/creatures')
      .then((r) => {
        if (active) setRows(r.creatures);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const available = rows.filter(
    (c) =>
      c.kind === kind &&
      c.name.toLowerCase().includes(query.toLowerCase()) &&
      !(
        c.kind === 'NPC' && combat.combatants.some((p) => p.creatureId === c.id)
      ),
  );
  async function add() {
    setBusy(true);
    setError('');
    try {
      onAdded(
        await addCombatParticipants(combat, [
          {
            creatureId: selected,
            quantity: 1,
            spatialVisibilities: [hidden ? 'master-only' : 'public'],
            disposition: relation,
            ...(position ? { positions: [position] } : {}),
          },
        ]),
      );
    } catch (e) {
      const message =
        e instanceof Error ? e.message : 'Não foi possível adicionar.';
      setError(message);
      onError(message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="combat-reinforcement">
      <div className="preparation-inline">
        <button
          className="btn btn-small"
          aria-pressed={kind === 'CREATURE'}
          onClick={() => {
            setKind('CREATURE');
            setSelected('');
            setRelation('hostile');
          }}
        >
          Criaturas
        </button>
        <button
          className="btn btn-small"
          aria-pressed={kind === 'NPC'}
          onClick={() => {
            setKind('NPC');
            setSelected('');
            setRelation('neutral');
          }}
        >
          NPCs
        </button>
      </div>
      <input
        aria-label="Buscar reforço"
        placeholder="Buscar pelo nome"
        value={query}
        disabled={busy}
        onChange={(e) => setQuery(e.target.value)}
      />
      {loading ? <p role="status">Carregando participantes…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="combat-reinforcement-list">
        {available.map((c) => (
          <button
            key={c.id}
            className="btn"
            disabled={busy}
            aria-pressed={selected === c.id}
            onClick={() => setSelected(c.id)}
          >
            <Portrait src={c.imageUrl ?? ''} size="sm" zoomable={false} />
            {c.name}
          </button>
        ))}
      </div>
      {!loading && !available.length ? (
        <p className="section-note">
          Nenhum participante disponível para este filtro.
        </p>
      ) : null}
      <label>
        Relação
        <select
          value={relation}
          disabled={busy}
          onChange={(e) => setRelation(e.target.value as typeof relation)}
        >
          <option value="hostile">Hostil</option>
          <option value="neutral">Neutro</option>
          <option value="allied">Aliado</option>
        </select>
      </label>
      <label className="creature-checkbox">
        <input
          type="checkbox"
          checked={hidden}
          disabled={busy}
          onChange={(e) => setHidden(e.target.checked)}
        />
        Entrar oculto dos jogadores
      </label>
      <p className="section-note">
        {position
          ? 'Será colocado na casa clicada.'
          : 'Será adicionado sem posição no mapa.'}{' '}
        {combat.status === 'ACTIVE'
          ? 'A iniciativa será rolada sem interromper o turno atual.'
          : 'A iniciativa será rolada na preparação.'}
      </p>
      <button
        className="btn btn-primary"
        disabled={busy || !selected}
        onClick={() => void add()}
      >
        {busy ? 'Adicionando…' : 'Adicionar ao combate'}
      </button>
    </div>
  );
}
