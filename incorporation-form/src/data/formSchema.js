// Field ids mirror the ones used when the original PDF factsheet was made fillable,
// so a submission maps 1:1 back to "PART n" of the source document.

const personBlock = (prefix, { withCompanyLabel = false, withUen = false, withController = false, withShares = false } = {}) => {
  const fields = [];

  fields.push({ id: `${prefix}_name`, label: withCompanyLabel ? 'Name / Company' : 'Name', type: 'text', required: true, span: 2 });

  if (withUen) {
    fields.push({ id: `${prefix}_nric_passport_fin_uen`, label: 'NRIC / Passport / FIN Number / UEN', type: 'text', span: 1 });
    fields.push({ id: `${prefix}_number_of_shares`, label: 'Number of Shares', type: 'text', span: 1 });
  } else {
    fields.push({ id: `${prefix}_nric`, label: 'NRIC / Passport / FIN Number', type: 'text', span: 1 });
    fields.push({ id: `${prefix}_occupation`, label: 'Occupation', type: 'text', span: 1 });
  }

  if (withController) {
    fields.push({
      id: `${prefix}_controller`,
      label: 'Controller?',
      hint: '(Must be more than 25%)',
      type: 'checkbox-group',
      span: 1,
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' }
      ]
    });
    fields.push({ id: `${prefix}_shareholding_pct`, label: 'Shareholding %', type: 'text', span: 1 });
  }

  fields.push({ id: `${prefix}_address`, label: withCompanyLabel ? 'Address' : 'Residential Address', type: 'textarea', required: true, span: 2 });

  fields.push({ id: `${prefix}_country_of_birth`, label: 'Country of Birth', type: 'text', span: 1 });
  fields.push({ id: `${prefix}_date_of_birth`, label: withShares ? 'Date of Birth / Inc.' : 'Date of Birth', type: 'date', span: 1 });

  fields.push({ id: `${prefix}_nationality`, label: 'Nationality', type: 'text', span: 1 });
  fields.push({
    id: `${prefix}_sex`,
    label: 'Sex',
    type: 'checkbox-group',
    span: 1,
    options: [
      { value: 'male', label: 'Male' },
      { value: 'female', label: 'Female' }
    ]
  });

  fields.push({ id: `${prefix}_tel`, label: 'Tel', type: 'tel', span: 1 });
  fields.push({ id: `${prefix}_mobile`, label: 'Mobile', type: 'tel', required: true, span: 1 });
  fields.push({ id: `${prefix}_email`, label: 'Email Address', type: 'email', required: true, span: 2 });

  return fields;
};

export const MIN_PEOPLE = 1;
export const MAX_PEOPLE = 5;

function buildDirectorSubsections(count) {
  const subs = [];
  for (let n = 1; n <= count; n += 1) {
    subs.push({
      id: `director${n}`,
      title: n === 1 ? '1) Director (at least one must be Singaporean or Singapore PR)' : `${n}) Director`,
      fields: personBlock(`director${n}`)
    });
  }
  return subs;
}

function buildShareholderSubsections(count) {
  const subs = [];
  for (let n = 1; n <= count; n += 1) {
    subs.push({
      id: `shareholder${n}`,
      title: `${n}) Shareholder`,
      fields: personBlock(`shareholder${n}`, { withCompanyLabel: true, withUen: true, withController: true, withShares: true })
    });
  }
  return subs;
}

export function buildFormSchema({ directorCount = 1, shareholderCount = 1 } = {}) {
  return [
    ...BASE_SCHEMA_HEAD,
    { id: 'part7', title: 'Part 7: Directors', hint: 'Please provide a copy of NRIC / FIN / Passport and Proof of Residence (utility / mobile bill if foreigner)',
      subsections: buildDirectorSubsections(directorCount) },
    { id: 'part8', title: 'Part 8: Shareholders (Individual or Company)', hint: 'Please provide a copy of NRIC / FIN / Passport and Proof of Residence (utility / mobile bill if foreigner)',
      subsections: buildShareholderSubsections(shareholderCount) },
    ...BASE_SCHEMA_TAIL
  ];
}

const BASE_SCHEMA_HEAD = [
  {
    id: 'part1',
    title: 'Part 1: Proposed Company Names',
    fields: [
      { id: 'company_name_1', label: 'Company Name 1', type: 'text', required: true, span: 2 },
      { id: 'company_name_2', label: 'Company Name 2', type: 'text', span: 2 },
      { id: 'company_name_3', label: 'Company Name 3', type: 'text', span: 2 }
    ]
  },
  {
    id: 'part2',
    title: 'Part 2: Principal Business Activities',
    fields: [
      { id: 'activity_1', label: 'Activity 1', type: 'text', required: true, span: 2 },
      { id: 'description_1', label: 'Description', type: 'textarea', span: 2 },
      { id: 'activity_2', label: 'Activity 2', type: 'text', span: 2 },
      { id: 'description_2', label: 'Description', type: 'textarea', span: 2 }
    ]
  },
  {
    id: 'part3',
    title: 'Part 3: Intended Paid Up Capital',
    fields: [
      { id: 'share_capital_amount', label: 'Initial Share Capital (SGD)', hint: 'Min 1 and Max 100', type: 'number', required: true, span: 1 },
      { id: 'number_of_shares', label: 'Number of Shares', type: 'number', required: true, span: 1 }
    ]
  },
  {
    id: 'part4',
    title: 'Part 4: Company Singapore Registered Address',
    fields: [
      { id: 'registered_address', label: 'Address', type: 'textarea', required: true, span: 2 }
    ]
  },
  {
    id: 'part5',
    title: 'Part 5: First Financial Year Ended',
    fields: [
      { id: 'first_fye', label: 'First FYE', type: 'date', required: true, span: 1 }
    ]
  },
  {
    id: 'part6',
    title: 'Part 6: Bank Account Opening',
    fields: [
      {
        id: 'bank_name',
        label: 'Bank Name',
        type: 'checkbox-group',
        span: 2,
        options: [
          { value: 'dbs', label: 'DBS' },
          { value: 'uob', label: 'UOB' },
          { value: 'ocbc', label: 'OCBC' },
          { value: 'others', label: 'Others' }
        ]
      },
      { id: 'bank_others_name', label: 'Other bank name', type: 'text', span: 2, showIf: { field: 'bank_name', includes: 'others' } },
      { id: 'authorised_signatory_1', label: 'Name of Authorised Signatory', type: 'text', span: 2 },
      { id: 'authorised_signatory_2', label: 'Name of Authorised Signatory', type: 'text', span: 2 },
      { id: 'authorised_signatory_3', label: 'Name of Authorised Signatory', type: 'text', span: 2 },
      {
        id: 'signing_arrangement',
        label: 'Signing Arrangements',
        type: 'checkbox-group',
        span: 2,
        options: [
          { value: 'singly', label: 'To sign singly' },
          { value: 'any_one', label: 'Any One to sign singly' },
          { value: 'jointly', label: 'Both to sign jointly' },
          { value: 'others', label: 'Others' }
        ]
      },
      { id: 'signing_others_text', label: 'Other signing arrangement', type: 'text', span: 2, showIf: { field: 'signing_arrangement', includes: 'others' } }
    ]
  },
];

const BASE_SCHEMA_TAIL = [
  {
    id: 'part9',
    title: 'Part 9: Company Secretary',
    hint: 'Must be Singaporean or Singapore PR — please provide copy of NRIC',
    fields: personBlock('secretary')
  },
  {
    id: 'part10',
    title: 'Part 10: Contact Information',
    fields: [
      { id: 'contact_person_name', label: 'Name', type: 'text', required: true, span: 2 },
      { id: 'contact_person_tel', label: 'Tel', type: 'tel', span: 1 },
      { id: 'contact_person_mobile', label: 'Mobile', type: 'tel', required: true, span: 1 },
      { id: 'contact_person_email', label: 'Email Address', type: 'email', required: true, span: 2 }
    ]
  },
  {
    id: 'part11',
    title: 'Part 11: Commercial Reasons',
    fields: [
      {
        id: 'commercial_reason',
        label: 'Commercial Reason',
        type: 'select',
        required: true,
        span: 2,
        options: [
          { value: 'risk_management', label: 'Risk Management' },
          { value: 'evaluating_business_performance', label: 'Evaluating Business Performance' },
          { value: 'estate_succession_planning', label: 'Estate and Succession Planning' },
          { value: 'all', label: 'All of the above' },
          { value: 'others', label: 'Others' }
        ]
      },
      {
        id: 'commercial_reason_others_text',
        label: 'Please specify',
        type: 'text',
        required: true,
        span: 2,
        showIf: { field: 'commercial_reason', equals: 'others' }
      }
    ]
  },
  {
    id: 'part12',
    title: 'Confirmation & Signature',
    fields: [
      {
        id: 'signature',
        label: 'Signature',
        type: 'signature',
        required: true,
        span: 2
      },
      { id: 'signature_name', label: 'Name', type: 'text', required: true, span: 1 },
      { id: 'signature_date', label: 'Date', type: 'date', required: true, span: 1 }
    ]
  }
];

export const DEFAULT_FORM_SCHEMA = buildFormSchema({ directorCount: 1, shareholderCount: 1 });

export function flattenFields(schema = DEFAULT_FORM_SCHEMA) {
  const out = [];
  for (const section of schema) {
    if (section.fields) out.push(...section.fields);
    if (section.subsections) {
      for (const sub of section.subsections) out.push(...sub.fields);
    }
  }
  return out;
}

export function buildInitialFormState(schema = DEFAULT_FORM_SCHEMA) {
  const state = {};
  for (const field of flattenFields(schema)) {
    if (field.type === 'checkbox-group') state[field.id] = [];
    else state[field.id] = '';
  }
  return state;
}
