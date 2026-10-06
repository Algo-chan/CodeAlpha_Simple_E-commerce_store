/**
 * Auth forms.
 *
 * One component serving sign-in and registration. The two pages are so close -
 * the same card, same email and password, an extra name + phone + confirmation
 * on registration - that separate components would drift out of sync on the
 * first change to error handling or field styling.
 *
 * The component owns everything inside the card: the fields, their client-side
 * validation (mirroring the backend's rules so a shopper hears about a problem
 * before a round-trip), the submit button's locked state, and the mapping of
 * server errors onto fields. The page owns everything outside it: the layout,
 * the breadcrumb, and where to go on success.
 */
import { el, clear, on } from '../../core/dom.js';
import { button } from '../ui/button.js';
import { field } from './field.js';
import { pageTitle } from '../layout/page-header.js';
import { formAlert, applyApiFieldErrors, passwordIssue, phoneIssue } from '../../utils/forms.js';
import { icon } from '../../utils/icons.js';

/** The benefit column used on both pages. */
export function authCopy() {
  return el('div.auth-copy', {}, [
    pageTitle('Your basket, on every device', {
      lede: 'An account holds your address book, keeps your saved items together and speeds up checkout when it arrives.',
    }),
    el('div.auth-copy__perks', {}, [
      authPerk({
        icon: 'gift',
        title: 'Saved items follow you',
        text: 'Your wishlist is tied to the account, so it stays put across devices.',
      }),
      authPerk({
        icon: 'map-pin',
        title: 'One address book',
        text: 'Your delivery details are there the moment checkout arrives.',
      }),
      authPerk({
        icon: 'lock',
        title: 'Signed in, not locked in',
        text: 'Browsing as a guest always stays an option.',
      }),
    ]),
  ]);
}

function authPerk({ icon: iconName, title, text }) {
  return el('div.auth-copy__perk', {}, [
    icon(iconName),
    el('p.auth-copy__perk-title', { text: title }),
    el('p.auth-copy__perk-text', { text }),
  ]);
}

/**
 * @param {object} options
 * @param {'login'|'register'} options.mode
 * @param {object} options.auth        auth store
 * @param {string} [options.redirect]  preserved `?redirect=` for the switch link
 * @param {(user: object|null) => void} options.onSuccess
 * @returns {{ element: HTMLElement, destroy(): void }}
 */
export function authForm({ mode = 'login', auth, redirect = '', onSuccess }) {
  const isRegister = mode === 'register';

  const name = isRegister
    ? field({
        label: 'Full name',
        name: 'name',
        autocomplete: 'name',
        required: true,
        noValidate: true,
      })
    : null;

  const email = field({
    label: 'Email',
    type: 'email',
    name: 'email',
    autocomplete: 'email',
    placeholder: 'you@example.com',
    required: true,
    noValidate: true,
  });

  const phone = isRegister
    ? field({
        label: 'Phone',
        type: 'tel',
        name: 'phone',
        autocomplete: 'tel',
        placeholder: '0911 000 000',
        required: true,
        noValidate: true,
        onInput: () => phone.clearError(),
      })
    : null;

  const password = field({
    label: 'Password',
    type: 'password',
    name: 'password',
    autocomplete: isRegister ? 'new-password' : 'current-password',
    hint: isRegister
      ? '8 or more characters, with lower and upper case, a number and a symbol.'
      : null,
    required: true,
    noValidate: true,
    onInput: isRegister ? () => password.clearError() : undefined,
  });

  const confirm = isRegister
    ? field({
        label: 'Confirm password',
        type: 'password',
        name: 'passwordConfirmation',
        autocomplete: 'new-password',
        required: true,
        noValidate: true,
      })
    : null;

  // Keyed by the field names the API validation error paths use, so a 422
  // `details.errors` entry maps straight onto the field that caused it.
  const fields = { name, email, phone, password, passwordConfirmation: confirm };

  const payloadFields = isRegister ? [name, email, phone, password, confirm] : [email, password];

  const submit = button({
    label: isRegister ? 'Create account' : 'Sign in',
    variant: 'primary',
    block: true,
    type: 'submit',
  });

  const alertSlot = el('div');
  const switchText = isRegister ? 'Already registered?' : 'New here?';
  const switchHref = `${isRegister ? '/login.html' : '/register.html'}${redirect}`;

  const title = isRegister
    ? pageTitle('Create your account', {
        eyebrow: 'Register',
        lede: 'A few details and you are set.',
      })
    : pageTitle('Welcome back', { eyebrow: 'Sign in', lede: 'Pick up where you left off.' });

  const element = el('form.auth-card', { noValidate: true }, [
    title,
    el('div.auth-card__body', {}, [
      name ? name.element : null,
      email.element,
      phone ? phone.element : null,
      password.element,
      confirm ? confirm.element : null,
      alertSlot,
      submit.element,
    ]),
    el('div.auth-card__switch', {}, [
      switchText,
      ' ',
      el('a.btn-unstyled', { href: switchHref }, [
        isRegister ? 'Sign in instead' : 'Create an account',
      ]),
    ]),
  ]);

  const cleanups = [
    on(element, 'submit', (event) => {
      event.preventDefault();
      clear(alertSlot);

      const allValid = payloadFields.every((f) => f.validate());
      if (!allValid) return;

      if (isRegister) {
        if (name.getValue().trim().length < 2) {
          name.setError('Use at least 2 characters.');
          name.focus();
          return;
        }
        const phoneProblem = phoneIssue(phone.getValue());
        if (phoneProblem) {
          phone.setError(phoneProblem);
          phone.focus();
          return;
        }
        const issue = passwordIssue(password.getValue());
        if (issue) {
          password.setError(issue);
          password.focus();
          return;
        }
        if (confirm.getValue() !== password.getValue()) {
          confirm.setError('The two passwords do not match.');
          confirm.focus();
          return;
        }
      }

      submit.run(async () => {
        try {
          const body = isRegister
            ? {
                name: name.getValue().trim(),
                email: email.getValue().trim(),
                phone: phone.getValue().trim(),
                password: password.getValue(),
                passwordConfirmation: confirm.getValue(),
              }
            : { email: email.getValue().trim(), password: password.getValue() };
          const user = isRegister ? await auth.register(body) : await auth.signIn(body);
          onSuccess(user);
        } catch (error) {
          showError(error);
        }
      });
    }),
  ];

  function showError(error) {
    const applied = applyApiFieldErrors(fields, error);
    if (applied && fields[applied]) {
      fields[applied].focus();
      return;
    }
    const alert = formAlert(
      error?.message ??
        (isRegister ? 'We could not create the account.' : 'We could not sign you in.')
    );
    alertSlot.append(alert);
    alert.focus();
  }

  return {
    element,
    destroy() {
      cleanups.forEach((fn) => fn());
    },
  };
}

export default { authForm, authCopy };
