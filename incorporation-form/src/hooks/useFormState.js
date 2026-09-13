import { useCallback, useMemo, useState } from 'react';
import { FORM_SCHEMA, buildInitialFormState, flattenFields } from '../data/formSchema.js';

function isFieldVisible(field, formState) {
  if (!field.showIf) return true;
  const dep = formState[field.showIf.field];
  if (field.showIf.includes) return Array.isArray(dep) && dep.includes(field.showIf.includes);
  return Boolean(dep);
}

export function useFormState() {
  const [formState, setFormState] = useState(() => buildInitialFormState());
  const [errors, setErrors] = useState({});

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

  const allFields = useMemo(() => flattenFields(FORM_SCHEMA), []);

  const validate = useCallback(() => {
    const nextErrors = {};
    for (const field of allFields) {
      if (!field.required) continue;
      if (!isFieldVisible(field, formState)) continue;
      const value = formState[field.id];
      const empty = field.type === 'checkbox-group' ? !Array.isArray(value) || value.length === 0 : !value;
      if (empty) nextErrors[field.id] = 'This field is required';
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }, [allFields, formState]);

  return { formState, setValue, toggleCheckboxOption, errors, validate, isFieldVisible };
}
