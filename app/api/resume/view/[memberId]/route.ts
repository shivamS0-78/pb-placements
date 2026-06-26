import { NextRequest, NextResponse } from 'next/server';
import { MemberService } from '@/lib/db';
import { createClient } from '@supabase/supabase-js';

async function getMemberAndUrl(memberId: string, filename?: string | null) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const member = await MemberService.getMemberById(supabase, memberId);
  let resumeUrl = member?.resume_url;

  if (filename) {
    // Sanitize filename to avoid path traversal (keep only alphanumeric, underscores, hyphens, and single dot for extension)
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9_\-\.]/g, '');
    if (sanitizedFilename && sanitizedFilename.endsWith('.pdf')) {
      const userFolder = `resumes/${memberId}`;
      const { data } = supabase.storage
        .from('resume')
        .getPublicUrl(`${userFolder}/${sanitizedFilename}`);
      if (data?.publicUrl) {
        resumeUrl = data.publicUrl;
      }
    }
  }

  return { member, resumeUrl };
}

export async function HEAD(req: NextRequest, { params }: { params: { memberId: string } }) {
  try {
    const { memberId } = params;
    if (!memberId) return new NextResponse(null, { status: 400 });

    const searchParams = req.nextUrl.searchParams;
    const filename = searchParams.get('filename');

    const { resumeUrl } = await getMemberAndUrl(memberId, filename);
    if (!resumeUrl) return new NextResponse(null, { status: 404 });

    return new NextResponse(null, { status: 200 });
  } catch (error) {
    return new NextResponse(null, { status: 500 });
  }
}

export async function GET(req: NextRequest, { params }: { params: { memberId: string } }) {
  try {
    const { memberId } = params;
    if (!memberId) {
      return NextResponse.json({ message: 'memberId is required' }, { status: 400 });
    }

    const searchParams = req.nextUrl.searchParams;
    const filename = searchParams.get('filename');

    const { member, resumeUrl } = await getMemberAndUrl(memberId, filename);
    if (!member || !resumeUrl) {
      return NextResponse.json({ message: 'Resume not found' }, { status: 404 });
    }

    const upstream = await fetch(resumeUrl);
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ message: 'Failed to load resume' }, { status: 502 });
    }

    let displayFilename = 'resume.pdf';
    try {
      const url = new URL(resumeUrl);
      const pathParts = url.pathname.split('/');
      const lastPart = pathParts[pathParts.length - 1];
      if (lastPart && lastPart.includes('.pdf')) {
        displayFilename = lastPart;
      } else {
        displayFilename = `${member.name || 'resume'}.pdf`;
      }
    } catch {
      displayFilename = `${member.name || 'resume'}.pdf`;
    }

    const headers = new Headers();
    headers.set('Content-Type', 'application/pdf');
    headers.set('Content-Disposition', `inline; filename="${displayFilename}"`);
    headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    headers.set('Pragma', 'no-cache');
    headers.set('Expires', '0');

    return new NextResponse(upstream.body, { status: 200, headers });
  } catch (error) {
    console.error('[RESUME_PROXY_ERROR]', error);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}