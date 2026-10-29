import { describe, expect, it } from 'vitest';
import { loginSchema } from '@dddbanker/shared';
import { validateSignup } from '../../stations/handlers';
import { errorsFromApi, errorsFromZod, hasErrors } from './formErrors';
import { balanceCell, movementCell } from './money';
import { durationOf, visibleChars } from './typewriter';

describe('form errors', () => {
  it('maps Zod issues to the first message per field', () => {
    const parsed = loginSchema.safeParse({ email: 'nope', password: '' });
    expect(parsed.success).toBe(false);
    const errors = errorsFromZod(parsed.error!);
    expect(Object.keys(errors.fields).sort()).toEqual(['email', 'password']);
    expect(errors.form).toBeNull();
  });

  it('puts server field errors inline and other failures at the top', () => {
    const inline = errorsFromApi(
      {
        error: 'VALIDATION',
        message: 'Please check the highlighted fields.',
        fields: { password: 'Too short', 'deep.thing': 'x' },
      },
      ['email', 'password'],
    );
    expect(inline).toEqual({ fields: { password: 'Too short' }, form: null });

    const top = errorsFromApi(
      {
        error: 'INVALID_CREDENTIALS',
        message: 'That email and password combination did not work.',
      },
      ['email'],
    );
    expect(top).toEqual({ fields: {}, form: 'That email and password combination did not work.' });

    const locked = errorsFromApi({ error: 'LOCKED', message: 'Too many failed attempts.' }, [
      'email',
    ]);
    expect(locked.form).toBe('Too many failed attempts.');
  });

  it('gives a friendly message when the server could not be reached', () => {
    const offline = errorsFromApi(null, ['email']);
    expect(offline.form).toMatch(/couldn't reach/);
    expect(hasErrors(offline)).toBe(true);
  });
});

describe('signup validation', () => {
  const good = {
    name: 'Robin',
    email: 'robin@bramblewood.test',
    password: 'a cozy little bank',
    confirm: 'a cozy little bank',
  };

  it('accepts a good signup', () => {
    expect(hasErrors(validateSignup(good))).toBe(false);
  });

  it('catches mismatched passwords', () => {
    expect(validateSignup({ ...good, confirm: 'something else entirely' }).fields.confirm).toMatch(
      /match/,
    );
  });

  it('reports every bad field at once', () => {
    const errors = validateSignup({ name: '', email: 'x', password: 'short', confirm: 'short' });
    expect(Object.keys(errors.fields).sort()).toEqual(['email', 'name', 'password']);
  });
});

describe('money cells', () => {
  it('signs movements so color is never the only cue', () => {
    expect(movementCell(2500)).toEqual({ text: '+$25.00', tone: 'credit', label: 'plus $25.00' });
    expect(movementCell(-2500)).toEqual({ text: '-$25.00', tone: 'debit', label: 'minus $25.00' });
    expect(movementCell(0).tone).toBe('neutral');
  });

  it('shows balances plainly, flagging negatives', () => {
    expect(balanceCell(100_000)).toEqual({
      text: '$1,000.00',
      tone: 'neutral',
      label: '$1,000.00',
    });
    expect(balanceCell(-1250)).toMatchObject({
      text: '-$12.50',
      tone: 'debit',
      label: 'minus $12.50',
    });
  });
});

describe('typewriter pacing', () => {
  it('reveals text over time and finishes', () => {
    const text = 'Hello there';
    expect(visibleChars(text, 0)).toBe(0);
    const mid = visibleChars(text, 100);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(text.length);
    expect(visibleChars(text, durationOf(text) + 1)).toBe(text.length);
  });

  it('pauses after sentence punctuation', () => {
    // Same length; the one with a full stop in the middle takes longer.
    expect(durationOf('Hi. There')).toBeGreaterThan(durationOf('Hi, There'));
    expect(durationOf('Hi, There')).toBeGreaterThan(durationOf('Hi  There'));
  });

  it('keeps long lines brisk', () => {
    const line = 'Welcome to the Bank of Bramblewood! Checking in today?';
    expect(durationOf(line)).toBeLessThan(1500);
  });
});
