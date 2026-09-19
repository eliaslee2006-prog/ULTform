import { useCallback, useMemo, useState } from 'react';
import { buildFormSchema, buildInitialFormState, flattenFields, MIN_PEOPLE, MAX_PEOPLE } from '../data/formSchema.js';

function isFieldVisible(field, formState) {
  if (!field.showIf) return true;
  const dep = formState[field.showIf.field];
  if (field.showIf.includes) return Array.isArray(dep) && dep.includes(field.showIf.includes);
  if (field.showIf.equals !== undefined) return dep === field.showIf.equals;
  return Boolean(dep);
}

export function useFormState() {
  const [directorCount, setDirectorCount] = useState(MIN_PEOPLE);
  const [shareholderCount, setShareholderCount] = useState(MIN_PEOPLE);
  // Keep every field ever rendered (up to MAX_PEOPLE of each) in state, so decrementing
  // and re-incrementing a count doesn't lose already-entered values.
  const [formState, setFormState] = useState(() => buildInitialFormState(buildFormSchema({ directorCount: MAX_PEOPLE, shareholderCount: MAX_PEOPLE })));
  const [errors, setErrors] = useState({});

  const schema = useMemo(() => buildFormSchema({ directorCount, shareholderCount }), [directorCount, shareholderCount]);

  const changeDirectorCount = useCallback((next) => {
    setDirectorCount(Math.min(MAX_PEOPLE, Math.max(MIN_PEOPLE, next)));
  }, []);

  const changeShareholderCount = useCallback((next) => {
    setShareholderCount(Math.min(MAX_PEOPLE, Math.max(MIN_PEOPLE, next)));
  }, []);

  const setValue = useCallback((id, value) => {
    setFormState((prev) => ({ ...prev, [id]: value }));
    setErrors((prev) => (prev[id] ? { ...prev, [id]: null } : prev));
  }, []);

  const toggleCheckboxOption = useCallback((id, optionValue) => {
    setFormState((prev) => {
      const current = Array.isArray(prev[id]) ? prev[id] : [];
      const next = current.includes(optionValue) ? current.filter((v) => v !== optionValue) : [...current, optionValue];
      return { ...prev, [id]: next };
    });
  }, []);

  const setValues = useCallback((updates) => {
    setFormState((prev) => ({ ...prev, ...updates }));
  }, []);

  const validate = useCallback(() => {
    const nextErrors = {};
    for (const field of flattenFields(schema)) {
      if (!field.required) continue;
      if (!isFieldVisible(field, formState)) continue;
      const value = formState[field.id];
      const empty = field.type === 'checkbox-group' ? !Array.isArray(value) || value.length === 0 : !value;
      if (empty) nextErrors[field.id] = 'This field is required';
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }, [schema, formState]);

  return {
    schema,
    directorCount,
    shareholderCount,
    changeDirectorCount,
    changeShareholderCount,
    formState,
    setValue,
    setValues,
    toggleCheckboxOption,
    errors,
    validate,
    isFieldVisible
  };
}
