/**
 * Lista "Recursos restaurados" de um resultado de descanso (5.3E.2).
 *
 * Agrupa por ORIGEM (Classe / Raça) com os NOMES reais vindos do servidor — os
 * ids técnicos nunca aparecem. Um grupo sem recursos é OMITIDO (nada de
 * "Raça: —"), e sem nenhum recurso restaurado o bloco inteiro some, deixando o
 * resultado sem linhas genéricas de "restaurado".
 *
 * Os nomes vêm das auditorias do servidor: `classResourcesRestored` e
 * `racialResourcesRestored` (as mesmas listas do Short e do Long Rest).
 */
export function RestoredResources({
  classResources,
  racialResources,
}: {
  classResources?: string[];
  racialResources?: string[];
}) {
  const groups: { label: string; names: string[] }[] = [];
  if (classResources && classResources.length > 0) {
    groups.push({ label: 'Classe', names: classResources });
  }
  if (racialResources && racialResources.length > 0) {
    groups.push({ label: 'Raça', names: racialResources });
  }

  if (groups.length === 0) return null;

  return (
    <div className="restored-resources">
      <h3 className="subsection-title">Recursos restaurados</h3>
      {groups.map((group) => (
        <div className="restored-resource-group" key={group.label}>
          <span className="restored-resource-origin">{group.label}</span>
          <ul className="restored-resource-list">
            {group.names.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
