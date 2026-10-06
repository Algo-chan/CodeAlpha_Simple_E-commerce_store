/**
 * Account page.
 *
 * Profile, address book and security. Three concerns, one page, because all
 * three read the same single session: this is where a customer manages the
 * data a future checkout will use.
 *
 * The page re-renders its own content after every mutation rather than
 * mutating the DOM in place. A basket of state this small - one user, a short
 * address list - is cheaper to rebuild correctly than to patch and risk one
 * card showing a value the server has already reordered.
 */
import { el, clear, on } from '../core/dom.js';
import { api } from '../core/api.js';
import { button } from '../components/ui/button.js';
import { field, select } from '../components/forms/field.js';
import { pageTitle } from '../components/layout/page-header.js';
import { breadcrumb } from '../components/layout/breadcrumb.js';
import { errorState, state } from '../components/feedback/states.js';
import { formAlert, applyApiFieldErrors, passwordIssue, phoneIssue } from '../utils/forms.js';
import { icon } from '../utils/icons.js';

/**
 * @param {object} options
 * @param {HTMLElement} options.host
 * @param {object} options.auth
 * @param {object} [options.client]   API client, injectable for tests
 * @param {object} [options.ui]       toast store, for success feedback
 * @returns {{ destroy(): void }}
 */
export default async function accountPage({ host, auth, client = api, ui = null }) {
  document.title = 'Your account - Aster & Oak';
  if (auth.selectStatus() === 'unknown') await auth.refresh();

  const shell = el('div.container.account-shell');
  host.replaceChildren(shell);
  shell.append(breadcrumb([{ label: 'Account' }]));

  const status = auth.selectStatus();
  if (status === 'failure') {
    shell.append(
      errorState({
        error: { code: 'NETWORK_ERROR' },
        title: 'We could not reach the store',
        onRetry: () => globalThis.location.reload(),
      })
    );
    return { destroy: () => {} };
  }

  if (!auth.selectUser()) {
    shell.append(signInPrompt());
    return { destroy: () => {} };
  }

  shell.append(pageTitle('Your account', { eyebrow: 'Customer account' }));

  const layout = el('div.account-layout');
  shell.append(layout);

  let addresses = [];
  let addressesError = null;

  async function loadAddresses() {
    try {
      const data = await client.get('/auth/addresses');
      addresses = data?.addresses ?? [];
      addressesError = null;
    } catch (error) {
      addressesError = error;
    }
  }

  async function reloadAddresses() {
    await loadAddresses();
    redraw();
  }

  function notify(title) {
    ui?.pushToast?.({ title, tone: 'success' });
  }

  function notifyError(message) {
    ui?.pushToast?.({ title: message, tone: 'error' });
  }

  function redraw() {
    clear(layout);
    const user = auth.selectUser();
    layout.append(sidebar({ user, auth }));

    layout.append(
      el('div.account-columns.account-columns--2', {}, [
        detailsCard({ user, auth, notify, onChanged: redraw }),
        securityCard({ client, notify }),
      ]),
      addressesCard({
        addresses,
        addressesError,
        client,
        notify,
        notifyError,
        onReload: reloadAddresses,
      })
    );
  }

  await loadAddresses();
  redraw();

  return { destroy: () => {} };
}

/** The signed-out outcome, reached when the session check comes back empty. */
function signInPrompt() {
  return state({
    variant: 'info',
    icon: 'user',
    title: 'Sign in to open your account',
    description: 'Your details, address book and saved items live behind your account.',
    actions: [
      { label: 'Sign in', href: '/login.html', variant: 'primary' },
      { label: 'Create an account', href: '/register.html', variant: 'ghost' },
    ],
  });
}

/* -------------------------------------------------------------------------- */
/* Sidebar                                                                     */
/* -------------------------------------------------------------------------- */

function sidebar({ user, auth }) {
  const links = [
    { href: '#details', label: 'Your details', icon: 'user' },
    { href: '#addresses', label: 'Address book', icon: 'map-pin' },
    { href: '#security', label: 'Security', icon: 'lock' },
    { href: '/wishlist.html', label: 'Saved items', icon: 'heart' },
    { href: '/cart.html', label: 'Your cart', icon: 'cart' },
  ];

  const signOut = button({
    label: 'Sign out',
    variant: 'ghost',
    icon: 'log-out',
    auto: true,
    onClick: async () => {
      await auth.signOut();
      globalThis.location.assign('/login.html');
    },
  });

  return el('div', {}, [
    el('div.account-identity', {}, [
      el('div.account-identity__row', {}, [
        el('span.account-identity__avatar', { 'aria-hidden': 'true', text: initials(user.name) }),
        el('div', {}, [
          el('p.account-identity__name', { text: user.name }),
          el('p.account-identity__email', { text: user.email }),
        ]),
      ]),
    ]),
    el(
      'nav.account-nav',
      { 'aria-label': 'Account' },
      links.map((item, index) =>
        el(
          'a.account-nav__link',
          { href: item.href, ...(index === 0 ? { 'aria-current': 'page' } : {}) },
          [icon(item.icon), item.label]
        )
      )
    ),
    signOut.element,
  ]);
}

/* -------------------------------------------------------------------------- */
/* Your details                                                                */
/* -------------------------------------------------------------------------- */

function detailsCard({ user, auth, notify, onChanged }) {
  let editing = false;
  const body = el('div');

  function draw() {
    clear(body);

    if (!editing) {
      body.append(
        el('dl.account-defs', {}, [
          defRow('Full name', user.name),
          defRow('Email', user.email),
          defRow('Phone', user.phone || 'Not provided'),
        ]),
        el('div.form-actions', {}, [
          button({
            label: 'Edit details',
            variant: 'outline',
            icon: 'pencil',
            onClick: () => {
              editing = true;
              draw();
            },
          }).element,
        ])
      );
      return;
    }

    const nameField = field({
      label: 'Full name',
      name: 'name',
      autocomplete: 'name',
      required: true,
      noValidate: true,
      value: user.name,
    });
    const phoneField = field({
      label: 'Phone',
      type: 'tel',
      name: 'phone',
      autocomplete: 'tel',
      hint: 'Digits only, 9-15. Leave blank to keep the current one.',
      noValidate: true,
      value: user.phone ?? '',
    });
    const fields = { name: nameField, phone: phoneField };
    const alertSlot = el('div');
    const save = button({ label: 'Save changes', variant: 'primary', type: 'submit' });
    const cancel = button({
      label: 'Cancel',
      variant: 'ghost',
      onClick: () => {
        editing = false;
        draw();
      },
    });

    const form = el('form.field-group', { noValidate: true }, [
      nameField.element,
      phoneField.element,
      alertSlot,
      el('div.form-actions', {}, [save.element, cancel.element]),
    ]);

    on(form, 'submit', (event) => {
      event.preventDefault();
      clear(alertSlot);

      const valid = [nameField, phoneField].every((f) => f.validate());
      if (!valid) return;
      if (nameField.getValue().trim().length < 2) {
        nameField.setError('Use at least 2 characters.');
        nameField.focus();
        return;
      }
      const phoneValue = phoneField.getValue().trim();
      const phoneProblem = phoneValue ? phoneIssue(phoneValue) : null;
      if (phoneProblem) {
        phoneField.setError(phoneProblem);
        phoneField.focus();
        return;
      }

      save.run(async () => {
        try {
          await auth.updateProfile({
            name: nameField.getValue().trim(),
            ...(phoneValue ? { phone: phoneValue } : {}),
          });
          notify('Details updated.');
          editing = false;
          onChanged();
        } catch (error) {
          const applied = applyApiFieldErrors(fields, error);
          if (applied && fields[applied]) fields[applied].focus();
          else alertSlot.append(formAlert(error?.message ?? 'We could not save your details.'));
        }
      });
    });

    body.append(form);
  }

  draw();
  return surface('details', { eyebrow: 'Details', title: 'Your details' }, body);
}

/* -------------------------------------------------------------------------- */
/* Address book                                                                */
/* -------------------------------------------------------------------------- */

function addressesCard({ addresses, addressesError, client, notify, notifyError, onReload }) {
  const body = el('div');
  draw();

  function draw() {
    clear(body);

    if (addressesError) {
      body.append(
        errorState({
          error: addressesError,
          title: 'Could not load your address book',
          onRetry: onReload,
        })
      );
      return;
    }

    if (addresses.length === 0) {
      body.append(
        el('p.account-card__lede', {
          text: 'No addresses yet. Add one and it becomes your default.',
        }),
        addButton()
      );
      return;
    }

    body.append(el('div.address-list', { role: 'list' }, addresses.map(addressItem)), addButton());
  }

  function addButton() {
    return el('div.form-actions', {}, [
      button({
        label: 'Add an address',
        variant: 'outline',
        icon: 'plus',
        onClick: () => {
          clear(body);
          body.append(addressEditor({ address: null, client, notify, onDone: onReload }));
        },
      }).element,
    ]);
  }

  function addressItem(address) {
    const isDefault = Boolean(address.is_default);

    const lines = [
      `${address.street}, ${address.area}`,
      address.city,
      address.phone,
      ...(address.landmark ? [`Landmark: ${address.landmark}`] : []),
      ...(address.additional_notes ? [address.additional_notes] : []),
    ];

    const actions = [];
    if (!isDefault) {
      actions.push(
        button({
          label: 'Set as default',
          variant: 'ghost',
          size: 'sm',
          onClick: async () => {
            try {
              await client.post(`/auth/addresses/${address.id}/default`);
              notify('Default address updated.');
              onReload();
            } catch (error) {
              notifyError(error?.message ?? 'Could not update the default address.');
            }
          },
        }).element
      );
    }
    actions.push(
      button({
        label: 'Edit',
        variant: 'ghost',
        size: 'sm',
        icon: 'pencil',
        onClick: () => {
          clear(body);
          body.append(addressEditor({ address, client, notify, onDone: onReload }));
        },
      }).element,
      button({
        label: 'Remove',
        variant: 'quiet-danger',
        size: 'sm',
        onClick: async () => {
          try {
            await client.delete(`/auth/addresses/${address.id}`);
            notify('Address removed.');
            onReload();
          } catch (error) {
            notifyError(error?.message ?? 'Could not remove the address.');
          }
        },
      }).element
    );

    return el('div.address-card', { className: isDefault ? 'address-card--default' : null }, [
      el('div.address-card__name', {}, [
        el('span', { text: address.full_name }),
        isDefault ? el('span.address-card__badge', { text: 'Default' }) : null,
      ]),
      ...lines.map((line) => el('p.address-card__line', { text: line })),
      el('div.address-card__actions', {}, actions),
    ]);
  }

  return surface('addresses', { eyebrow: 'Addresses', title: 'Address book' }, body);
}

function addressEditor({ address = null, client, notify, onDone }) {
  const editing = Boolean(address);
  const existingLabel = address?.label ?? '';

  // The customer may have a custom label stored, so the current value is added
  // as an option rather than dropped when it does not match the presets.
  const labelOptions = [
    ...(existingLabel && !['Home', 'Work', 'Other'].includes(existingLabel)
      ? [{ value: existingLabel, label: existingLabel }]
      : []),
    { value: 'Home', label: 'Home' },
    { value: 'Work', label: 'Work' },
    { value: 'Other', label: 'Other' },
  ];

  const label = select({
    label: 'Label',
    hint: 'A short name so you can tell your addresses apart.',
    value: existingLabel || 'Home',
    options: labelOptions,
  });

  const full_name = field({
    label: 'Full name',
    name: 'full_name',
    autocomplete: 'name',
    required: true,
    noValidate: true,
    value: address?.full_name ?? '',
  });
  const phone = field({
    label: 'Phone',
    type: 'tel',
    name: 'phone',
    autocomplete: 'tel',
    required: true,
    noValidate: true,
    value: address?.phone ?? '',
  });
  const city = field({
    label: 'City',
    name: 'city',
    required: true,
    noValidate: true,
    value: address?.city ?? '',
  });
  const area = field({
    label: 'Area / sub-city',
    name: 'area',
    required: true,
    noValidate: true,
    value: address?.area ?? '',
  });
  const street = field({
    label: 'Street',
    name: 'street',
    required: true,
    noValidate: true,
    value: address?.street ?? '',
  });
  const landmark = field({
    label: 'Landmark',
    name: 'landmark',
    optional: true,
    noValidate: true,
    value: address?.landmark ?? '',
  });
  const additional_notes = field({
    label: 'Notes for the courier',
    name: 'additional_notes',
    optional: true,
    noValidate: true,
    maxlength: '1000',
    value: address?.additional_notes ?? '',
  });

  const fields = { label, full_name, phone, city, area, street, landmark, additional_notes };
  const alertSlot = el('div');
  const save = button({
    label: editing ? 'Save address' : 'Add address',
    variant: 'primary',
    type: 'submit',
  });
  const cancel = button({ label: 'Cancel', variant: 'ghost', onClick: onDone });

  const form = el('form.field-group', { noValidate: true }, [
    label.element,
    full_name.element,
    el('div.field-group.field-group--2', {}, [city.element, area.element]),
    street.element,
    phone.element,
    landmark.element,
    additional_notes.element,
    alertSlot,
    el('div.form-actions', {}, [save.element, cancel.element]),
  ]);

  on(form, 'submit', (event) => {
    event.preventDefault();
    clear(alertSlot);

    const valid = [full_name, phone, city, area, street].every((f) => f.validate());
    if (!valid) return;

    const phoneValue = phone.getValue().trim();
    const phoneProblem = phoneIssue(phoneValue);
    if (phoneProblem) {
      phone.setError(phoneProblem);
      phone.focus();
      return;
    }

    const body = {
      label: label.getValue(),
      full_name: full_name.getValue().trim(),
      phone: phoneValue,
      city: city.getValue().trim(),
      area: area.getValue().trim(),
      street: street.getValue().trim(),
      ...(landmark.getValue().trim() ? { landmark: landmark.getValue().trim() } : {}),
      ...(additional_notes.getValue().trim()
        ? { additional_notes: additional_notes.getValue().trim() }
        : {}),
    };

    save.run(async () => {
      try {
        if (editing) await client.patch(`/auth/addresses/${address.id}`, body);
        else await client.post('/auth/addresses', body);
        notify(editing ? 'Address updated.' : 'Address added.');
        onDone();
      } catch (error) {
        const applied = applyApiFieldErrors(fields, error);
        if (applied && fields[applied]) fields[applied].focus();
        else alertSlot.append(formAlert(error?.message ?? 'We could not save this address.'));
      }
    });
  });

  return surface(
    editing ? address.id : 'addresses',
    {
      eyebrow: editing ? 'Editing' : 'Addresses',
      title: editing ? 'Edit address' : 'Add an address',
    },
    form
  );
}

/* -------------------------------------------------------------------------- */
/* Security                                                                    */
/* -------------------------------------------------------------------------- */

function securityCard({ client, notify }) {
  const currentPassword = field({
    label: 'Current password',
    type: 'password',
    name: 'currentPassword',
    autocomplete: 'current-password',
    required: true,
    noValidate: true,
  });
  const newPassword = field({
    label: 'New password',
    type: 'password',
    name: 'newPassword',
    autocomplete: 'new-password',
    required: true,
    noValidate: true,
    hint: '8 or more characters, with lower and upper case, a number and a symbol.',
  });
  const confirm = field({
    label: 'Confirm new password',
    type: 'password',
    name: 'newPasswordConfirmation',
    autocomplete: 'new-password',
    required: true,
    noValidate: true,
  });

  const fields = { currentPassword, newPassword, newPasswordConfirmation: confirm };
  const alertSlot = el('div');
  const successSlot = el('div');
  const save = button({ label: 'Change password', variant: 'primary', type: 'submit' });

  const form = el('form.field-group', { noValidate: true }, [
    currentPassword.element,
    newPassword.element,
    confirm.element,
    alertSlot,
    successSlot,
    el('div.form-actions', {}, [save.element]),
  ]);

  on(form, 'submit', (event) => {
    event.preventDefault();
    clear(alertSlot);
    clear(successSlot);

    const valid = [currentPassword, newPassword, confirm].every((f) => f.validate());
    if (!valid) return;

    const issue = passwordIssue(newPassword.getValue());
    if (issue) {
      newPassword.setError(issue);
      newPassword.focus();
      return;
    }
    if (newPassword.getValue() !== confirm.getValue()) {
      confirm.setError('The two passwords do not match.');
      confirm.focus();
      return;
    }

    save.run(async () => {
      try {
        await client.post('/auth/password', {
          currentPassword: currentPassword.getValue(),
          newPassword: newPassword.getValue(),
          newPasswordConfirmation: confirm.getValue(),
        });
        currentPassword.setValue('');
        newPassword.setValue('');
        confirm.setValue('');
        successSlot.append(formAlert('Password updated.', { variant: 'success' }));
        notify('Password updated.');
      } catch (error) {
        const applied = applyApiFieldErrors(fields, error);
        if (applied && fields[applied]) fields[applied].focus();
        else alertSlot.append(formAlert(error?.message ?? 'We could not change your password.'));
      }
    });
  });

  return surface('security', { eyebrow: 'Security', title: 'Security' }, form);
}

/* -------------------------------------------------------------------------- */
/* Shared bits                                                                 */
/* -------------------------------------------------------------------------- */

/** Wraps a titled section inside the account content column. The title carries
 *  the id the sidebar anchor targets. */
function surface(id, { eyebrow, title }, body) {
  return el('section.account-card', { id, 'aria-labelledby': `${id}-title` }, [
    el('div.account-card__head', {}, [
      eyebrow ? el('p.section-head__eyebrow', { text: eyebrow }) : null,
      el('h2.account-card__title', { id: `${id}-title`, text: title }),
    ]),
    body,
  ]);
}

/** A definition-style row for the profile read view. */
function defRow(term, value) {
  return el('div.account-def', {}, [el('dt', { text: term }), el('dd', { text: value })]);
}

/** "Name Surname" -> "NS", for the avatar monogram. */
function initials(name) {
  const words = String(name ?? '')
    .trim()
    .split(/\s+/)
    .slice(0, 2);
  const letters = words.map((word) => word[0]?.toUpperCase() ?? '').join('');
  return letters || 'U';
}
