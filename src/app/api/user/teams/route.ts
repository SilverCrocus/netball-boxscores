import { createUserResourceHandlers } from '@/lib/user-resource-route';

export const { GET, POST, DELETE } = createUserResourceHandlers({
  model: 'userTeam',
  foreignKey: 'teamId',
  include: { team: true },
});
