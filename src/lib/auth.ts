import type { NextAuthOptions } from 'next-auth';
import type { Adapter } from 'next-auth/adapters';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import { PrismaAdapter } from '@auth/prisma-adapter';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { normalizeEmail } from '@/lib/email';
import {
  clientIdentifier,
  consumeRateLimit,
  opaqueIdentifier,
} from '@/lib/request-security';

const INVALID_CREDENTIAL_HASH = '$2b$12$8NXFRGggfARTsKPdaJjJteif4/GuNjJiZLNHV2rYJoFGCrNkJi03u';
const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

const providers: NextAuthOptions['providers'] = [
  CredentialsProvider({
    name: 'credentials',
    credentials: {
      email: { label: 'Email', type: 'email' },
      password: { label: 'Password', type: 'password' },
    },
    async authorize(credentials, request) {
      if (!credentials?.email || !credentials?.password) return null;

      const normalizedEmail = normalizeEmail(credentials.email);
      if (!normalizedEmail || normalizedEmail.length > 254 || credentials.password.length > 128) {
        return null;
      }

      const ipDecision = consumeRateLimit({
        scope: 'credential-login-ip',
        identifier: clientIdentifier(request.headers ?? {}),
        limit: 30,
        windowMs: 15 * 60_000,
      });
      const accountDecision = consumeRateLimit({
        scope: 'credential-login-account',
        identifier: opaqueIdentifier(normalizedEmail),
        limit: 10,
        windowMs: 15 * 60_000,
      });
      if (!ipDecision.allowed || !accountDecision.allowed) return null;

      const user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
      });
      const isValid = await bcrypt.compare(
        credentials.password,
        user?.passwordHash ?? INVALID_CREDENTIAL_HASH,
      );
      if (!user || !user.passwordHash || !isValid) return null;

      return { id: user.id, email: user.email, name: user.name };
    },
  }),
];

if (googleClientId && googleClientSecret) {
  providers.push(GoogleProvider({
    clientId: googleClientId,
    clientSecret: googleClientSecret,
  }));
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as Adapter,
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/auth/signin',
  },
  providers,
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
    async redirect({ url, baseUrl }) {
      try {
        const destination = new URL(url, baseUrl);
        return destination.origin === new URL(baseUrl).origin
          ? destination.toString()
          : baseUrl;
      } catch {
        return baseUrl;
      }
    },
  },
};
