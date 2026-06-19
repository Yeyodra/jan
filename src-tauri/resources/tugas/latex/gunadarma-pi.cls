%% gunadarma-pi.cls
%% LaTeX Class untuk Penulisan Ilmiah Universitas Gunadarma
%% Sesuai Buku Pedoman Penulisan Ilmiah Prodi Informatika 2025
%%
%% Author: Template Generator
%% Version: 1.0
%% Date: 2026

\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{gunadarma-pi}[2026/01/31 Gunadarma PI Class v1.0]

%% Base class
\LoadClass[12pt,a4paper,oneside]{book}

%% ============================================================================
%% PACKAGES
%% ============================================================================

% Encoding & Font
\RequirePackage[T1]{fontenc}
\RequirePackage[utf8]{inputenc}
\RequirePackage{newtxtext,newtxmath} % Times New Roman font (includes math)

% Page Layout - Margin: atas 4cm, bawah 3cm, kiri 4cm, kanan 3cm
\RequirePackage[
    a4paper,
    top=4cm,
    bottom=3cm,
    left=4cm,
    right=3cm,
    headheight=15pt
]{geometry}

% Spacing - 1.5 spasi
\RequirePackage{setspace}
\onehalfspacing

% Paragraph indent
\setlength{\parindent}{1.25cm}

% Language
\RequirePackage[indonesian,english]{babel}

% Graphics
\RequirePackage{graphicx}
\RequirePackage{float}

% Tables
\RequirePackage{array}
\RequirePackage{booktabs}
\RequirePackage{longtable}
\RequirePackage{multirow}

% Caption untuk gambar dan tabel
\RequirePackage{caption}
\captionsetup[figure]{
    position=bottom,
    labelsep=space,
    justification=centering,
    font={normalsize},
    labelfont={normalsize},
    format=hang
}
\captionsetup[table]{
    position=top,
    labelsep=space,
    justification=centering,
    font={normalsize,singlespacing},
    labelfont={normalsize},
    format=hang
}

% Header & Footer
\RequirePackage{fancyhdr}

% Hyperlinks (tanpa warna/underline sesuai pedoman)
\RequirePackage[
    colorlinks=false,
    pdfborder={0 0 0},
    hidelinks
]{hyperref}

% TOC, LOF, LOT
\RequirePackage{tocloft}

% Numbering
\RequirePackage{chngcntr}

% Bibliography - tanpa natbib untuk hindari conflict
% \RequirePackage{natbib}
% \bibliographystyle{apalike}

% Misc
\RequirePackage{enumitem}
\RequirePackage{titlesec}
\RequirePackage{etoolbox}
\RequirePackage{xcolor}
\RequirePackage{amsmath}

%% ============================================================================
%% PAGE NUMBERING SETUP
%% ============================================================================

% Front matter: romawi kecil, tengah bawah
\fancypagestyle{frontmatter}{
    \fancyhf{}
    \fancyfoot[C]{\thepage}
    \renewcommand{\headrulewidth}{0pt}
    \renewcommand{\footrulewidth}{0pt}
}

% Main matter: arabic, pojok kanan atas (kecuali awal bab)
\fancypagestyle{mainmatter}{
    \fancyhf{}
    \fancyhead[R]{\thepage}
    \renewcommand{\headrulewidth}{0pt}
    \renewcommand{\footrulewidth}{0pt}
}

% Chapter first page: arabic, tengah bawah
% HANYA untuk halaman pertama setiap chapter
\fancypagestyle{plain}{
    \fancyhf{}
    \fancyfoot[C]{\thepage}
    \renewcommand{\headrulewidth}{0pt}
    \renewcommand{\footrulewidth}{0pt}
}

% Solusi: Set pagestyle mainmatter setelah halaman pertama chapter
% \@afterheading dipanggil SETELAH \thispagestyle{plain} dalam \chapter
\RequirePackage{afterpage}
\apptocmd{\@afterheading}{\afterpage{\pagestyle{mainmatter}}}{}{}

% Lampiran: L-1, L-2, tengah bawah
\fancypagestyle{lampiran}{
    \fancyhf{}
    \fancyfoot[C]{L-\thepage}
    \renewcommand{\headrulewidth}{0pt}
    \renewcommand{\footrulewidth}{0pt}
}

%% ============================================================================
%% CHAPTER & SECTION FORMATTING
%% Pedoman: 
%% - Judul Bagian (BAB): 14pt, Tebal, HURUF KAPITAL, Center
%% - Judul Subbagian: 12pt, Tebal, HURUF KAPITAL, Left
%% - Judul Sub-subbagian: 12pt, Tebal, Title Case, Left
%% ============================================================================

% Format nomor bab: 1. bukan BAB 1
\renewcommand{\thechapter}{\arabic{chapter}}
\renewcommand{\thesection}{\thechapter.\arabic{section}}
\renewcommand{\thesubsection}{\thesection.\arabic{subsection}}
\renewcommand{\thesubsubsection}{\thesubsection.\arabic{subsubsection}}

% Chapter: 14pt, Bold, UPPERCASE, Center
\titleformat{\chapter}[display]
    {\normalfont\fontsize{14}{16}\bfseries\centering}
    {\MakeUppercase{\chaptertitlename}\ \thechapter}
    {0pt}
    {\fontsize{14}{16}\bfseries\MakeUppercase}
\titlespacing*{\chapter}{0pt}{-20pt}{20pt}

% Section (Subbab): 12pt, Bold, UPPERCASE, Left
\titleformat{\section}
    {\normalfont\fontsize{12}{14}\bfseries}
    {\thesection.}
    {1em}
    {\MakeUppercase}
\titlespacing*{\section}{0pt}{12pt}{6pt}

% Subsection (Sub-subbab): 12pt, Bold, Title Case, Left
\titleformat{\subsection}
    {\normalfont\fontsize{12}{14}\bfseries}
    {\thesubsection.}
    {1em}
    {}
\titlespacing*{\subsection}{0pt}{12pt}{6pt}

% Subsubsection: 12pt, Bold, Title Case, Left
\titleformat{\subsubsection}
    {\normalfont\fontsize{12}{14}\bfseries}
    {\thesubsubsection.}
    {1em}
    {}
\titlespacing*{\subsubsection}{0pt}{12pt}{6pt}

%% ============================================================================
%% TABLE OF CONTENTS FORMATTING
%% ============================================================================

% TOC title — must use \AtBeginDocument because babel resets these at \begin{document}
\AtBeginDocument{%
  \renewcommand{\contentsname}{DAFTAR ISI}%
  \renewcommand{\listtablename}{DAFTAR TABEL}%
  \renewcommand{\listfigurename}{DAFTAR GAMBAR}%
}

% Chapter in TOC: Bold, Uppercase
\renewcommand{\cftchapfont}{\bfseries}
\renewcommand{\cftchappagefont}{\bfseries}
\renewcommand{\cftchapleader}{\cftdotfill{\cftdotsep}}

% Spacing in TOC
\setlength{\cftbeforechapskip}{6pt}
\setlength{\cftbeforesecskip}{3pt}

%% ============================================================================
%% FIGURE & TABLE NUMBERING
%% Pedoman: Gambar 3.1 = gambar pertama di BAB 3
%% ============================================================================

\counterwithin{figure}{chapter}
\counterwithin{table}{chapter}

\renewcommand{\thefigure}{\thechapter.\arabic{figure}}
\renewcommand{\thetable}{\thechapter.\arabic{table}}

%% ============================================================================
%% ABSTRACT ENVIRONMENT
%% Pedoman: 1 spasi, max 200 kata
%% ============================================================================

\newenvironment{abstrak}{
    \chapter*{ABSTRAK}
    \addcontentsline{toc}{chapter}{ABSTRAK}
    \begin{singlespace}
}{
    \end{singlespace}
}

\newenvironment{abstract}{
    \chapter*{ABSTRACT}
    \addcontentsline{toc}{chapter}{ABSTRACT}
    \begin{singlespace}
}{
    \end{singlespace}
}

%% ============================================================================
%% KATA PENGANTAR
%% ============================================================================

\newenvironment{katapengantar}{
    \chapter*{KATA PENGANTAR}
    \addcontentsline{toc}{chapter}{KATA PENGANTAR}
}{
}

%% ============================================================================
%% LAMPIRAN
%% Pedoman: Font 8pt, spasi 1, nomor halaman L-1, L-2, dst
%% ============================================================================

\newcounter{lampiran}
\renewcommand{\thelampiran}{L-\arabic{lampiran}}

\newcommand{\lampiran}[1]{
    \refstepcounter{lampiran}
    \chapter*{LAMPIRAN \arabic{lampiran}\\#1}
    \addcontentsline{toc}{chapter}{Lampiran \arabic{lampiran} #1}
}

\newenvironment{lampiranenv}{
    \pagestyle{lampiran}
    \setcounter{page}{1}
    \fontsize{8}{10}\selectfont
    \begin{singlespace}
}{
    \end{singlespace}
}

%% ============================================================================
%% DAFTAR PUSTAKA
%% Pedoman: Alfabetik, 1 spasi dalam item, 2 spasi antar item
%% ============================================================================

\renewcommand{\bibname}{DAFTAR PUSTAKA}

%% ============================================================================
%% CUSTOM COMMANDS
%% ============================================================================

% Data mahasiswa
\newcommand{\@judul}{}
\newcommand{\@judulEN}{}
\newcommand{\@nama}{}
\newcommand{\@npm}{}
\newcommand{\@prodi}{Informatika}
\newcommand{\@fakultas}{Teknologi Industri}
\newcommand{\@universitas}{Universitas Gunadarma}
\newcommand{\@pembimbing}{}
\newcommand{\@tahun}{}
\newcommand{\@tanggalsidang}{}
\newcommand{\@tanggallulus}{}
\newcommand{\@katakunci}{}
\newcommand{\@keywords}{}

\newcommand{\judul}[1]{\renewcommand{\@judul}{#1}}
\newcommand{\judulEN}[1]{\renewcommand{\@judulEN}{#1}}
\newcommand{\nama}[1]{\renewcommand{\@nama}{#1}}
\newcommand{\npm}[1]{\renewcommand{\@npm}{#1}}
\newcommand{\prodi}[1]{\renewcommand{\@prodi}{#1}}
\newcommand{\fakultas}[1]{\renewcommand{\@fakultas}{#1}}
\newcommand{\pembimbing}[1]{\renewcommand{\@pembimbing}{#1}}
\newcommand{\tahun}[1]{\renewcommand{\@tahun}{#1}}
\newcommand{\tanggalsidang}[1]{\renewcommand{\@tanggalsidang}{#1}}
\newcommand{\tanggallulus}[1]{\renewcommand{\@tanggallulus}{#1}}
\newcommand{\katakunci}[1]{\renewcommand{\@katakunci}{#1}}
\newcommand{\keywords}[1]{\renewcommand{\@keywords}{#1}}

%% ============================================================================
%% HALAMAN JUDUL
%% Pedoman: Center, Logo 6cm, Judul 14pt KAPITAL
%% ============================================================================

\newcommand{\halamanJudul}{
    \thispagestyle{empty}
    \begin{center}
        \begin{singlespace}
            
        {\fontsize{14}{16}\selectfont\bfseries UNIVERSITAS GUNADARMA}\\[0.5cm]
        {\fontsize{14}{16}\selectfont\bfseries FAKULTAS \MakeUppercase{\@fakultas}}\\[1.5cm]
        
        % Logo Gunadarma
        \includegraphics[width=6cm]{logo-gunadarma}\\[1.5cm]
        
        {\fontsize{14}{16}\selectfont\bfseries PENULISAN ILMIAH}\\[1cm]
        
        {\fontsize{14}{16}\selectfont\bfseries \MakeUppercase{\@judul}}\\[2cm]
        
        {\fontsize{12}{14}\selectfont
        \begin{tabular}{@{}l@{ : }l@{}}
            Nama & \@nama \\
            NPM & \@npm \\
            Program Studi & \@prodi \\
            Pembimbing & \@pembimbing
        \end{tabular}
        }\\[2cm]
        
        {\fontsize{12}{14}\selectfont\bfseries JAKARTA}\\
        {\fontsize{12}{14}\selectfont\bfseries \@tahun}
        
        \end{singlespace}
    \end{center}
    \clearpage
}

%% ============================================================================
%% LEMBAR ORISINALITAS DAN PUBLIKASI
%% ============================================================================

\newcommand{\halamanOrisinalitas}{
    \chapter*{PERNYATAAN ORISINALITAS DAN PUBLIKASI}
    \addcontentsline{toc}{chapter}{PERNYATAAN ORISINALITAS DAN PUBLIKASI}
    
    Saya yang bertanda tangan di bawah ini,
    
    \begin{tabular}{@{}l@{ : }l@{}}
        Nama & \@nama \\
        NPM & \@npm \\
        Judul PI & \@judul \\
        Tanggal Sidang & \@tanggalsidang \\
        Tanggal Lulus & \@tanggallulus
    \end{tabular}
    
    \vspace{0.5cm}
    
    menyatakan bahwa tulisan ini adalah merupakan hasil karya saya sendiri dan dapat 
    dipublikasikan sepenuhnya oleh Universitas Gunadarma. Segala kutipan dalam bentuk 
    apa pun telah mengikuti kaidah, etika yang berlaku. Mengenai isi dan tulisan adalah 
    merupakan tanggung jawab Penulis, bukan Universitas Gunadarma. Demikian pernyataan 
    ini dibuat dengan sebenarnya dan dengan penuh kesadaran.
    
    \vspace{1.5cm}
    
    \begin{flushright}
        Jakarta, \@tanggallulus \\[2cm]
        \underline{\hspace{4cm}} \\
        ( \@nama )
    \end{flushright}
    
    \clearpage
}

%% ============================================================================
%% LEMBAR PENGESAHAN
%% ============================================================================

\newcommand{\halamanPengesahan}{
    \chapter*{LEMBAR PENGESAHAN}
    \addcontentsline{toc}{chapter}{LEMBAR PENGESAHAN}
    
    \begin{tabular}{@{}l@{ : }p{10cm}@{}}
        Judul PI & \@judul \\
        Nama & \@nama \\
        NPM & \@npm \\
        Program Studi & \@prodi \\
        Tanggal Sidang & \@tanggalsidang \\
        Tanggal Lulus & \@tanggallulus
    \end{tabular}
    
    \vspace{1.5cm}
    
    \begin{center}
        Menyetujui
    \end{center}
    
    \vspace{1cm}
    
    \begin{center}
        \begin{tabular}{ccc}
            Pembimbing & \hspace{2cm} & Kasubbag. Sidang PI \\[2cm]
            \underline{\hspace{5cm}} & & \underline{\hspace{5cm}} \\
            ( \@pembimbing ) & & ( Dr. Achmad Fahrurozi, S.Si., M.Si. )
        \end{tabular}
    \end{center}
    
    \vspace{1.5cm}
    
    \begin{center}
        Ketua Program Studi \\[2cm]
        \underline{\hspace{6cm}} \\
        ( Prof. Dr. Lintang Yuniar Banowosari, S.Kom., M.Sc. )
    \end{center}
    
    \clearpage
}

%% ============================================================================
%% SETUP FRONT MATTER & MAIN MATTER
%% ============================================================================

\let\oldfrontmatter\frontmatter
\renewcommand{\frontmatter}{
    \oldfrontmatter
    \pagestyle{frontmatter}
    \pagenumbering{roman}
}

\let\oldmainmatter\mainmatter
\renewcommand{\mainmatter}{
    \oldmainmatter
    \pagestyle{mainmatter}
    \pagenumbering{arabic}
}

% Fix: thebibliography jangan reset page style
\let\oldthebibliography\thebibliography
\renewcommand{\thebibliography}[1]{
    \oldthebibliography{#1}
    \thispagestyle{plain}  % Halaman pertama daftar pustaka = bawah tengah
}

%% ============================================================================
%% END OF CLASS
%% ============================================================================

\endinput
