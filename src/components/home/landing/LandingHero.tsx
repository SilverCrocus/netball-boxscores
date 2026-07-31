import Image from 'next/image';
import Link from 'next/link';
import type { LandingLink } from './types';

export interface LandingHeroProps {
  editionEyebrow: string;
  headline: string;
  description: string;
  imageSrc: string;
  imageAlt: string;
  primaryAction: LandingLink;
  secondaryAction: LandingLink;
}

export function LandingHero({
  editionEyebrow,
  headline,
  description,
  imageSrc,
  imageAlt,
  primaryAction,
  secondaryAction,
}: LandingHeroProps) {
  return (
    <section
      className="relative isolate h-[410px] overflow-hidden bg-primary text-white sm:h-[440px] lg:h-[470px]"
      aria-labelledby="landing-hero-heading"
    >
      <Image
        src={imageSrc}
        alt={imageAlt}
        fill
        priority
        sizes="100vw"
        className="-z-10 object-cover object-[61%_center] opacity-50 sm:object-[58%_center] sm:opacity-70 lg:object-center lg:opacity-100"
      />

      <div className="mx-auto flex h-full w-full max-w-[1488px] items-center px-5 sm:px-8 lg:px-16">
        <div className="max-w-[39rem]">
          <p className="mb-3 font-label text-[0.68rem] font-bold uppercase tracking-[0.2em] text-secondary-fixed sm:text-xs">
            {editionEyebrow}
          </p>
          <h1
            id="landing-hero-heading"
            className="max-w-[38rem] whitespace-pre-line font-headline text-[clamp(2.35rem,6vw,4.25rem)] font-black uppercase leading-[0.98] tracking-[-0.045em] text-white"
          >
            {headline}
          </h1>
          <p className="mt-4 max-w-[34rem] font-body text-base leading-relaxed text-white/90 sm:text-lg">
            {description}
          </p>

          <div className="mt-6 flex flex-col gap-3 min-[430px]:flex-row sm:mt-7 sm:gap-5">
            <Link
              href={primaryAction.href}
              prefetch={false}
              className="inline-flex min-h-12 items-center justify-center rounded-md bg-secondary-container px-6 py-3 text-center font-headline text-sm font-extrabold uppercase tracking-[0.05em] text-on-secondary-fixed shadow-sm transition-colors hover:bg-secondary-fixed focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-secondary-fixed"
            >
              {primaryAction.label}
            </Link>
            <Link
              href={secondaryAction.href}
              prefetch={false}
              className="inline-flex min-h-12 items-center justify-center rounded-md border border-white/75 bg-primary/35 px-6 py-3 text-center font-headline text-sm font-extrabold uppercase tracking-[0.05em] text-white transition-colors hover:border-secondary-fixed hover:text-secondary-fixed focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-secondary-fixed"
            >
              {secondaryAction.label}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
