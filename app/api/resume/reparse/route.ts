import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { extractTextFromPDF, analyzeWithMistral } from '@/lib/resume-parser';

export const dynamic = 'force-dynamic';

const createAuthenticatedClient = (token: string): SupabaseClient => {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } }
    }
  );
};

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return NextResponse.json({ success: false, message: 'Unauthorized: No token' }, { status: 401 });
    }

    const supabase = createAuthenticatedClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (!user || authError) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { filePath } = body;

    if (!filePath) {
      return NextResponse.json({ success: false, message: 'No filePath provided' }, { status: 400 });
    }

    // Security check: Ensure filePath starts with resumes/${user.id}/
    const expectedPrefix = `resumes/${user.id}/`;
    if (!filePath.startsWith(expectedPrefix)) {
      return NextResponse.json({ success: false, message: 'Unauthorized access to resume file' }, { status: 403 });
    }

    // Download PDF from Supabase Storage bucket 'resume'
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('resume')
      .download(filePath);

    if (downloadError || !fileData) {
      console.error('Error downloading resume from Supabase Storage:', downloadError);
      return NextResponse.json({ success: false, message: 'Failed to download resume file' }, { status: 500 });
    }

    const fileBuffer = await fileData.arrayBuffer();
    
    // Parse resume
    let parsedData: any;
    try {
      const { text: extractedText, links: extractedLinks } = await extractTextFromPDF(fileBuffer);
      if (!extractedText?.trim()) {
        return NextResponse.json({ success: false, message: 'Could not extract text from PDF.' }, { status: 400 });
      }
      parsedData = await analyzeWithMistral(extractedText, extractedLinks);
      if (!parsedData?.name || !parsedData?.email) {
        return NextResponse.json({ success: false, message: 'Failed to parse key details from resume.' }, { status: 400 });
      }
    } catch (parseError) {
      console.error('Error parsing resume:', parseError);
      return NextResponse.json({ success: false, message: 'Failed to parse resume.' }, { status: 400 });
    }

    const publicResumeUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/resume/${filePath}`;
    parsedData.resume_url = publicResumeUrl;

    return NextResponse.json({
      success: true,
      file_path: filePath,
      ...parsedData,
    });

  } catch (error) {
    console.error('Error processing resume reparse:', error);
    return NextResponse.json({ success: false, message: 'Failed to process resume reparse' }, { status: 500 });
  }
}
