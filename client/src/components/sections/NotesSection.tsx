import { useEffect, useState } from 'react';
import { useReadOnly } from '../../readonly';
import { Section } from '../Section';
import type { SheetSectionProps } from './common';

/**
 * Anotações são um texto livre grande: a edição é sempre "aberta", com
 * salvamento automático ao sair do campo (sem modal nem formulário).
 * Na visão do mestre o campo é apenas leitura.
 */
export function NotesSection({ character, update }: SheetSectionProps) {
  const readOnly = useReadOnly();
  const [draft, setDraft] = useState(character.notes);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Se a ficha mudar por fora (outra aba, por exemplo), acompanha o novo valor.
  useEffect(() => {
    setDraft(character.notes);
  }, [character.notes]);

  function save(): void {
    if (readOnly || draft === character.notes) return;
    update({ notes: draft });
    setSavedAt(new Date().toLocaleTimeString('pt-BR'));
  }

  return (
    <Section
      title="Anotações e História"
      icon="quill"
      subtitle={
        readOnly
          ? undefined
          : savedAt
            ? `salvo às ${savedAt}`
            : 'salvo automaticamente ao sair do campo'
      }
    >
      <textarea
        className="notes-area"
        value={draft}
        rows={10}
        readOnly={readOnly}
        aria-label="Anotações e história do personagem"
        placeholder={readOnly ? 'Sem anotações.' : 'História, personalidade, objetivos, contatos, pistas...'}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={save}
      />
    </Section>
  );
}
