import { createUserResourceHandlers } from '@/lib/user-resource-route';

export const { GET, POST, DELETE } = createUserResourceHandlers({
  model: 'userFavorite',
  foreignKey: 'matchId',
  include: { match: { include: { homeTeam: true, awayTeam: true } } },
});
