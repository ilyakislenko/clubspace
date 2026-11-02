import { entityHref } from './ChatMarkdown';

describe('entityHref', () => {
  it('opens the page of the person, group or tariff a chip names', () => {
    const chip = (type: 'member' | 'staff' | 'group' | 'plan') =>
      entityHref('w1', { token: 't', type, id: 'x1', label: 'Имя' });
    expect(chip('member')).toBe('/workspace/w1/users/x1');
    expect(chip('staff')).toBe('/workspace/w1/users/x1');
    expect(chip('group')).toBe('/workspace/w1/groups/x1');
    expect(chip('plan')).toBe('/workspace/w1/subscriptions/plans/x1');
  });
});
