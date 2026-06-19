%% gunadarma-tugas.cls
%% LaTeX Class untuk Tugas Kuliah Universitas Gunadarma
%% Simple assignment class — cover page + body content
%% Version: 1.0 | Date: 2026

\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{gunadarma-tugas}[2026/04/20 Gunadarma Tugas Class v1.0]

%% Base class — article (no chapters needed for assignments)
\LoadClass[12pt,a4paper]{article}

%% === PACKAGES ===

\RequirePackage[T1]{fontenc}
\RequirePackage[utf8]{inputenc}
\RequirePackage{newtxtext,newtxmath}          % Times New Roman
\RequirePackage[a4paper,top=3cm,bottom=3cm,left=3cm,right=3cm]{geometry}
\RequirePackage{setspace}
\onehalfspacing
\setlength{\parindent}{1.25cm}
\RequirePackage[indonesian,english]{babel}
\RequirePackage{graphicx}
\RequirePackage{float}
\RequirePackage{array}
\RequirePackage{booktabs}
\RequirePackage{listings}
\RequirePackage{xcolor}
\RequirePackage{titlesec}
\RequirePackage[colorlinks=false,pdfborder={0 0 0},hidelinks]{hyperref}
\RequirePackage{enumitem}
\RequirePackage{etoolbox}
\RequirePackage{caption}
\RequirePackage{amsmath}

%% === CODE LISTING STYLE ===

\definecolor{codebg}{RGB}{248,248,248}
\definecolor{codeframe}{RGB}{200,200,200}
\definecolor{codegreen}{RGB}{0,128,0}
\definecolor{codegray}{RGB}{128,128,128}
\definecolor{codeblue}{RGB}{0,0,180}

\lstset{
    basicstyle=\ttfamily\small,
    backgroundcolor=\color{codebg},
    frame=single,
    rulecolor=\color{codeframe},
    breaklines=true,
    tabsize=4,
    showstringspaces=false,
    numbers=left,
    numberstyle=\tiny\color{codegray},
    numbersep=8pt,
    xleftmargin=15pt,
    framexleftmargin=15pt,
    keywordstyle=\color{codeblue}\bfseries,
    commentstyle=\color{codegreen}\itshape,
    stringstyle=\color{red!70!black},
    captionpos=b
}

%% === BABEL FIX — Indonesian labels ===

\AtBeginDocument{%
  \renewcommand{\contentsname}{DAFTAR ISI}%
  \renewcommand{\listtablename}{DAFTAR TABEL}%
  \renewcommand{\listfigurename}{DAFTAR GAMBAR}%
  \renewcommand{\lstlistingname}{Kode}%
}

%% === SECTION FORMATTING ===
%% Section: 14pt Bold | Subsection: 12pt Bold | Subsubsection: 12pt Bold

\titleformat{\section}{\normalfont\fontsize{14}{16}\bfseries}{\thesection.}{1em}{}
\titlespacing*{\section}{0pt}{12pt}{6pt}
\titleformat{\subsection}{\normalfont\fontsize{12}{14}\bfseries}{\thesubsection.}{1em}{}
\titlespacing*{\subsection}{0pt}{12pt}{6pt}
\titleformat{\subsubsection}{\normalfont\fontsize{12}{14}\bfseries}{\thesubsubsection.}{1em}{}
\titlespacing*{\subsubsection}{0pt}{12pt}{6pt}

%% === CAPTION FORMATTING ===

\captionsetup[figure]{position=bottom,labelsep=space,justification=centering,font={normalsize}}
\captionsetup[table]{position=top,labelsep=space,justification=centering,font={normalsize,singlespacing}}
\captionsetup[lstlisting]{position=below,labelsep=space,font={normalsize}}

%% === STUDENT DATA COMMANDS ===

\newcommand{\@judul}{}
\newcommand{\@nama}{}
\newcommand{\@npm}{}
\newcommand{\@kelas}{}
\newcommand{\@matakuliah}{}
\newcommand{\@dosen}{}
\newcommand{\@tahun}{\the\year}
\newcommand{\@materipraktikum}{\@judul}
\newcommand{\@pertemuanke}{}
\newcommand{\@tanggalpemberian}{}
\newcommand{\@tanggalpengumpulan}{}
\newcommand{\@diterimaoleh}{\@dosen}
\newcommand{\@laboratorium}{LABORATORIUM TEKNIK INFORMATIKA}

\newcommand{\judul}[1]{\renewcommand{\@judul}{#1}}
\newcommand{\nama}[1]{\renewcommand{\@nama}{#1}}
\newcommand{\npm}[1]{\renewcommand{\@npm}{#1}}
\newcommand{\kelas}[1]{\renewcommand{\@kelas}{#1}}
\newcommand{\matakuliah}[1]{\renewcommand{\@matakuliah}{#1}}
\newcommand{\dosen}[1]{\renewcommand{\@dosen}{#1}}
\newcommand{\tahun}[1]{\renewcommand{\@tahun}{#1}}
\newcommand{\materipraktikum}[1]{\renewcommand{\@materipraktikum}{#1}}
\newcommand{\pertemuanke}[1]{\renewcommand{\@pertemuanke}{#1}}
\newcommand{\tanggalpemberian}[1]{\renewcommand{\@tanggalpemberian}{#1}}
\newcommand{\tanggalpengumpulan}[1]{\renewcommand{\@tanggalpengumpulan}{#1}}
\newcommand{\diterimaoleh}[1]{\renewcommand{\@diterimaoleh}{#1}}
\newcommand{\laboratorium}[1]{\renewcommand{\@laboratorium}{#1}}

%% === COVER PAGE ===

\newcommand{\halamanCover}{
    \thispagestyle{empty}
    \begin{center}
        \begin{singlespace}
        \vspace*{0.4cm}

        {\fontsize{14}{18}\selectfont\bfseries \@matakuliah\\[8pt]}
        {\fontsize{14}{18}\selectfont\bfseries \@materipraktikum\\[16pt]}

        {\fontsize{14}{18}\selectfont\bfseries \@nama\\[8pt]}
        {\fontsize{14}{18}\selectfont\bfseries \@npm\\[8pt]}
        {\fontsize{14}{18}\selectfont\bfseries \@kelas}

\vspace{1.35cm}

        {\fontsize{14}{18}\selectfont\bfseries
        \begin{tabular}{@{}p{6.1cm}@{\hspace{0.25cm}}c@{\hspace{0.25cm}}p{7.4cm}@{}}
            Pertemuan Ke & : & \@pertemuanke \\[8pt]
            Tanggal Pemberian Tugas & : & \@tanggalpemberian \\[8pt]
            Tanggal Pengumpulan Tugas & : & \@tanggalpengumpulan \\[8pt]
            Diterima Oleh & : & \@diterimaoleh
        \end{tabular}
        }

        \vfill

        \includegraphics[width=4cm]{logo-gunadarma.png}

        \vfill

        {\fontsize{14}{18}\selectfont\bfseries \@laboratorium}\\[6pt]
        {\fontsize{14}{18}\selectfont\bfseries UNIVERSITAS GUNADARMA}\\[6pt]
        {\fontsize{14}{18}\selectfont\bfseries \@tahun}
        \end{singlespace}
    \end{center}
    \clearpage
}

%% === PAGE STYLE ===

\pagestyle{plain}

\endinput
